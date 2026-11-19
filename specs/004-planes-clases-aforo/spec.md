# 004 · Planes y clases con aforo

- **Historias y requerimientos:** HU-19 y RN-07 (planes: nombre, veces por semana, clases por mes, duración, precio,
  días y franjas permitidos, niveles, vigencia, activo o inactivo; el cambio de precio solo vale para matrículas nuevas
  o renovaciones), HU-17 (clases por nivel, día, hora, entrenador y aforo; bloques de 1 hora; un entrenador no tiene dos
  clases en el mismo bloque), RN-09 (de 08:00 a 20:00 en bloques de 1 hora), RN-10 (clases de distinto nivel en el mismo
  bloque, cada una con su entrenador), RN-11 (aforo de 20 a 50; nunca inscripciones por encima del aforo), sección 1.2
  y glosario (aforo), sección 2.1 ("Configurar planes, horarios y aforo": solo el administrador), sección 9.1
  (entidades `PLAN` y `CLASE`), D-03 (el precio ya incluye IGV), D-15 (el nivel general decide en qué clases se
  inscribe el alumno), D-17 (cada historia crea sus tablas), D-23 (todo es por academia), D-29 (el Superadmin no ve
  datos internos), RN-22 y RNF-06 (auditoría), RNF-12 (America/Lima, soles). Prepara RN-25 (el precio y las clases por
  mes son la base del cobro proporcional) y RN-28, HU-02 y HU-03 (el cupo de cada clase), que usan las historias 005,
  007 y 010.
- **Ruta crítica:** en parte. Son críticos el aforo (RN-11: rango y forma de bloquear el cupo), el precio y las clases
  por mes (entradas del cálculo del cobro, RN-25 y D-03), el aislamiento entre academias de las tablas nuevas y los
  permisos. El resto del mantenimiento de planes y clases, la web, la semilla y la documentación no lo son (lista de
  `CLAUDE.md`: "mantenimiento simple de planes y clases (salvo lo que toca el aforo)"). _(Aprobado por el orquestador,
  DT-5; el backlog la marca "En parte".)_
- **Estado:** aprobada por el responsable (17/11/2026), con las propuestas de todas las preguntas de negocio (DR-1 a
  DR-8 de esta spec) y las técnicas aprobadas por el orquestador (DT-1 a DT-5), en "Decisiones". Ningún criterio
  cambió. No quedan preguntas abiertas. Ajustes técnicos de la implementación del backend (AT-1 a AT-5, sin cambios de
  negocio) en "Decisiones".
- **Ronda 1 adversarial:** 3 fallas (32, 33, 34), agregadas como criterios en "G. Ronda 1 adversarial" (17/11/2026).
  32 y 33 son de ruta crítica; 34 no (DT-6 de 004). Ninguna cambia una regla de negocio.
- **Ronda 2 adversarial:** 2 fallas en el 34 (no crítico), ninguna en ruta crítica (1 a 7, 10, 18, 22, 23, 32 y 33).
  Agregadas como criterios 34 a y 34 b en "H. Ronda 2 adversarial" (17/11/2026), con la decisión técnica DT-7 de 004.
  Ninguna cambia una regla de negocio.
- **Ronda 3 adversarial (de confirmación):** sin fallas en ruta crítica ni regresiones; una falla menor en 11 + 34
  aceptada como riesgo (19/11/2026). Se registran en "I. Ronda 3 adversarial" la precisión del 34 b sobre U+2028 y
  U+2029 y el criterio 34 c (mayúsculas acentuadas, requisito de LC_CTYPE); los riesgos, en "Riesgos aceptados"; y
  los ajustes menores de la revisión, en AT-6 a AT-8 de "Decisiones". Ninguno cambia una regla de negocio.

## Objetivo

Que el administrador de cada academia defina, sin tocar el código, los planes que vende (cuántas veces por semana,
cuántas clases al mes, precio final con IGV, días, franjas y niveles permitidos, vigencia) y las clases de la semana
(nivel, día, bloque de 1 hora, entrenador y aforo de 20 a 50). Son los datos de los que parten la inscripción (005), el
cobro (005 y 007), la asistencia (009) y la renovación (010). Esta historia deja, además, la regla común para que
ninguna historia siguiente pueda pasar del aforo de una clase, aunque dos personas tomen el último cupo a la vez.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Aislamiento en la base y en la API (1 a 3 y 6):** planes y clases son datos internos de cada academia (D-23). Una
  clase de A con el entrenador de B, o un `PATCH` que alcance un plan de B, rompe el aislamiento.
- **Permisos y actor vigente (5 y 7):** solo el administrador configura planes, horarios y aforo (sección 2.1); un
  administrador desactivado con una petición en curso no debe poder cambiar precios ni aforos (regla DT-5 de 002).
- **Invariantes en la base (4):** el aforo de 20 a 50, el precio mayor que cero y las clases por mes mayores que cero
  se exigen también con `CHECK`, porque las historias del cobro y del cupo confiarán en ellos.
- **Precio y clases por mes (10):** son el dividendo y el divisor de la fórmula del cobro proporcional (RN-25, D-03). Un
  precio guardado con coma flotante, con tres decimales o en cero, o unas clases por mes en cero, llegan al cobro.
- **Aforo (18, 22 y 23):** RN-11 y la lista de `CLAUDE.md` ("nunca más inscritos que el aforo, aunque dos personas
  tomen el último cupo a la vez"). En esta historia todavía no hay inscritos (ver "Decisiones", pregunta T1): lo crítico
  es que el aforo nunca salga de su rango y que cambiarlo use el mismo bloqueo de la fila de la clase que usarán las
  historias que ocupan cupos, para que un cambio de aforo y una inscripción nunca se crucen.
- **Ronda 1 adversarial (32 y 33):** el 32, porque un 500 en la carrera de los choques del bloque deja a la clase y al
  entrenador en un estado que el administrador no sabe interpretar, en las mismas escrituras de clases que se ordenan
  con el cupo (criterios 20 f y 22), y es el patrón de error que copiarán las historias del cupo; el 33 amplía el 4:
  un precio `NaN` llega al cobro (RN-25, D-03) y un arreglo de dos dimensiones deja a toda la academia sin la lista de
  planes, de la que parten la inscripción y el cobro.

No son críticos, pero llevan _(prueba obligatoria)_: 8, 9, 11 a 17, 19 a 21, 24, 25, 34, 34 a, 34 b y 34 c (API,
contratos y dominio; el 34 a también en la web) y 26 a 29
(web, con pruebas de componentes). Los 30 y 31 (semilla y documentación) los verifica el revisor.

## Criterios de aceptación

En estos criterios, "ruta de academia", "sesión válida" y "actor vigente" son los de la spec 002; A y B son dos
academias activas; "bloque" es una hora de inicio entre las 08:00 y las 19:00 en punto, y la clase dura hasta la hora
siguiente (RN-09). Los días de la semana van de 1 (lunes) a 7 (domingo), como en ISO 8601. Los rangos marcados
"provisional" dependen de la pregunta N1.

### A. Tablas y aislamiento en la base

1. **Tablas nuevas.** Dadas las migraciones aplicadas, entonces existen `planes` y `clases` con las columnas de "Cambios
   al modelo de datos", con RLS activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE` que comparan
   `academia_id` con `app_academia_actual()` con la forma exacta del criterio 132 de 001, sin política ni privilegio de
   `DELETE`, `UNIQUE (academia_id, id)` en las dos, y la llave foránea compuesta `clases (academia_id, entrenador_id)` →
   `usuarios (academia_id, id)`. Todas las pruebas de catálogo de 001 (criterios 9 a 13, 17, 18, 124 a 126 y 131 a 133)
   siguen pasando con las tablas nuevas, y `TABLAS_DESPUES_DE_MIGRAR` de
   `scripts/test/integracion/migraciones.test.mjs` suma `planes` y `clases`. _(crítico)_ (D-17, D-23; criterio 12 de
   001)
2. **Privilegios mínimos.** Dado el rol `aquagestion_app`, entonces sus privilegios son exactamente: en `planes`,
   `SELECT`, `INSERT` y `UPDATE` de `nombre`, `veces_por_semana`, `clases_por_mes`, `duracion_minutos`, `precio`,
   `dias_permitidos`, `franjas_permitidas`, `niveles_aplicables`, `vigencia_inicio`, `vigencia_fin`, `activo` y
   `actualizado_en`; en `clases`, `SELECT`, `INSERT` y `UPDATE` de `entrenador_id`, `aforo`, `activo` y
   `actualizado_en` (no puede cambiar el nivel, el día ni la hora de una clase, pregunta N4, ni la `academia_id` de
   ninguna fila). `PRIVILEGIOS_APP` (`backend/src/infraestructura/prisma/privilegios-app.ts`) y la lista de
   `scripts/lib/rol-app.mjs` se amplían igual, y la API sigue atendiendo (criterio 102 de 001). _(crítico)_ (D-23)
3. **RLS y llave compuesta.** Dados planes y clases en A y en B, como app: en contexto de A, `SELECT` devuelve solo las
   filas de A; un `INSERT` con `academia_id` de B y un `UPDATE` que mueve una fila de A a B fallan con `42501`; en
   contexto de plataforma o sin contexto, devuelven 0 filas y el `INSERT` falla. Un `INSERT` en `clases` de A con el
   `entrenador_id` de un usuario de B falla con `23503`, aunque quien inserte sea el dueño de las tablas. _(crítico)_
   (D-23, D-29)
4. **Invariantes con `CHECK`.** Dado un `INSERT` o `UPDATE` directo (como app y como dueño de las tablas), entonces
   falla con `23514`: `clases.aforo` fuera de 20 a 50; `planes.precio` menor o igual que 0; `planes.clases_por_mes`
   menor que 1; `planes.veces_por_semana` fuera de 1 a 7; `dias_permitidos` vacío, con un valor fuera de 1 a 7 o con
   menos días que `veces_por_semana`; `franjas_permitidas` vacía o con una hora que no sea un bloque; `niveles_aplicables`
   vacío; `vigencia_fin` anterior a `vigencia_inicio`; `clases.dia_semana` fuera de 1 a 7; `clases.hora_inicio` que no
   sea un bloque (minutos o segundos distintos de cero, antes de las 08:00 o después de las 19:00); y `clases.hora_fin`
   distinta de `hora_inicio` más una hora. _(crítico)_ (RN-09, RN-11, RN-25) _(Ampliado por el criterio 33, ronda 1
   adversarial: `NaN`, arreglos de varias dimensiones o con `NULL` y vigencias infinitas.)_

### B. Permisos, aislamiento en la API y actor vigente

5. **Permisos.** Dadas sesiones válidas de cada rol de A, entonces las seis rutas del contrato responden 200 o 201 al
   `ADMIN` y 403 `SIN_PERMISO` a `SECRETARIA`, `ENTRENADOR` y `ALUMNO`, sin escribir ni auditar nada; sin sesión, 401
   `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con A suspendida, 403
   `ACADEMIA_SUSPENDIDA`, en el orden de comprobaciones de 002. La cookie del Superadmin (`aq_plataforma`) responde 401
   y el Superadmin no tiene rutas de planes ni de clases (D-29). Todas usan el permiso
   `CONFIGURAR_PLANES_HORARIOS_AFORO`, que sigue solo con `ADMIN: 'TODO'`; `MATRIZ_PERMISOS` no cambia (24 filas;
   pregunta T2). _(crítico)_ (sección 2.1, D-29)
6. **Aislamiento en la API.** Dados planes y clases en A y en B, cuando un `ADMIN` de A usa las rutas, entonces:
   `GET /api/planes` y `GET /api/clases` traen solo filas de A; un `PATCH` sobre el id de un plan o una clase de B
   responde 404 `NO_ENCONTRADO`, con el mismo cuerpo que un id que no existe (y que un id que no es UUID); un cuerpo con
   `academiaId` o con cualquier campo que no sea del contrato responde 400 sin escribir; un parámetro de consulta
   `?academiaId=<id de B>` se ignora o responde 400, pero nunca muestra ni escribe datos de B; un `entrenadorId` de un
   usuario de B responde 409 `ENTRENADOR_NO_VALIDO`, igual que uno que no existe. Las filas y la auditoría de B no
   cambian. _(crítico)_ (D-23; criterio 20 de 002)
7. **El administrador sigue vigente dentro de la transacción.** `POST` y `PATCH` de planes y de clases llaman a
   `bloquearActorVigente` como primera sentencia de su `conAcademia` (regla DT-5 de 002). Prueba de carrera
   determinista, como la del criterio 56 de 002: la prueba desactiva al `ADMIN` X (`estado = 'INACTIVO'`,
   `version_token + 1`) en una transacción sin confirmar; X envía un `POST /api/planes` válido y un
   `PATCH /api/clases/{id}` con otro aforo, que pasan el middleware y quedan esperando; la prueba confirma. Entonces los
   dos responden 401 `NO_AUTENTICADO`, no se crea ni cambia ninguna fila y no hay auditoría. Lo mismo si solo sube
   `version_token`. _(crítico)_ (DT-5 de 002)

### C. Planes (HU-19, RN-07)

8. **Crear un plan.** Dado un `ADMIN` de A, cuando envía `POST /api/planes` con `crearPlanSchema` válido, entonces
   responde 201 con `{ plan }`: los días ordenados de 1 a 7, las franjas ordenadas por hora, los niveles en el orden
   `BASICO`, `INTERMEDIO`, `AVANZADO`, el precio como texto con dos decimales (`"120.00"`), `activo: true` y el `estado`
   del criterio 14; y registra `PLAN_CREADO` (entidad `plan`, `entidadId` el id, actor `USUARIO`, IP) con `datosDespues`
   del plan. `duracionMinutos` vale 60 si no se envía. _(prueba obligatoria)_ (HU-19, RN-07)
9. **Validación del plan.** Dado un cuerpo inválido, entonces responde 400 `SOLICITUD_INVALIDA` sin escribir ni
   auditar, con `detalles.errores[].campo` en el campo: `nombre` recortado de menos de 3 o más de 80 caracteres, con
   controles o con menos de 3 visibles (`textoVisibleSchema`); `vecesPorSemana` fuera de 1 a 7; `clasesPorMes` fuera de
   1 a 31 (provisional); `duracionMinutos` fuera de 15 a 60 (provisional); `diasPermitidos` vacío, con repetidos, con un
   valor fuera de 1 a 7 o con menos días que `vecesPorSemana` (HU-02: el alumno elige tantos días como la frecuencia del
   plan); `franjasPermitidas` vacía, con repetidas o con un texto que no sea un bloque (`"08:00"` a `"19:00"`);
   `nivelesAplicables` vacío, con repetidos o con un nivel desconocido; `vigenciaInicio` o `vigenciaFin` que no sean una
   fecha real `AAAA-MM-DD` (por ejemplo `2026-02-30`), o `vigenciaFin` anterior a `vigenciaInicio`; números no enteros,
   textos con dígitos o `null` donde va un entero. _(prueba obligatoria)_
10. **Precio exacto y clases por mes.** `precio` es un texto con hasta dos decimales, mayor que 0 y como mucho
    `"99999.99"` (provisional): `"120"`, `"120.5"`, `"0.01"` y `"99999.99"` se aceptan, se guardan en `numeric(10,2)`
    sin pasar por coma flotante y se devuelven como `"120.00"`, `"120.50"`, `"0.01"` y `"99999.99"`, también al leerlos
    con `GET /api/planes`. Responden 400 sin escribir: un número JSON (`120`), `"0"`, `"0.00"`, `"-1"`, `"120.505"`,
    `"1e2"`, `"120,50"`, `" 120"`, `"100000"`, `""` y `null`. `clasesPorMes` es un entero de 1 en adelante: `0` responde
    400 y nunca se guarda (es el divisor de RN-25). El precio es el monto final con IGV incluido: el sistema no le suma
    ni le resta nada (D-03). _(crítico)_ (RN-25, D-03)
11. **Nombre único.** Dado un plan de A llamado "Plan Mensual", cuando se crea o se renombra otro de A como
    "plan mensual" o " PLAN MENSUAL " (mismo nombre recortado, sin distinguir mayúsculas), entonces responde 409
    `NOMBRE_PLAN_EN_USO` sin escribir ni auditar, aunque el plan existente esté inactivo; en B se acepta. Dadas dos
    creaciones simultáneas con el mismo nombre en A, exactamente una responde 201 y la otra 409, y queda una fila y un
    `PLAN_CREADO` (provisional, pregunta N8). _(prueba obligatoria)_ _(Ampliado por el criterio 34, ronda 1
    adversarial: nombres que se ven iguales cuentan como el mismo.)_
12. **Editar un plan.** Dado un plan de A, cuando el `ADMIN` envía `PATCH /api/planes/{id}` con uno o más campos de
    `actualizarPlanSchema`, entonces responde 200 con `{ plan }` ya cambiado; las reglas que cruzan campos (días frente
    a veces por semana, fin frente a inicio de la vigencia) se comprueban con el resultado de combinar lo guardado y lo
    enviado, y si no se cumplen responde 400 con el campo enviado; con `null` en `vigenciaInicio` o `vigenciaFin` se
    quita esa fecha. Registra un solo `PLAN_ACTUALIZADO` con `datosAntes` y `datosDespues` solo de los campos que
    cambiaron. Un `PATCH` sin cambios responde 200 sin escribir ni auditar (dos envíos iguales dejan una sola
    auditoría). Dos `PATCH` simultáneos sobre el mismo plan responden 200 (nunca 500 ni `40P01`) y sus auditorías quedan
    encadenadas: el `datosAntes` de la segunda es el `datosDespues` de la primera. Cambiar el precio, las clases por mes
    o cualquier otro campo solo cambia la fila del plan (HU-19: vale para matrículas nuevas y renovaciones; ver "Reglas
    para las historias siguientes"). `{}` responde 400. _(prueba obligatoria)_ (HU-19, RNF-06)
13. **Activar y desactivar, sin borrar.** `PATCH` con `activo: false` desactiva el plan y con `activo: true` lo vuelve a
    activar, con su `PLAN_ACTUALIZADO`. No hay ruta para borrar planes ni clases: `DELETE /api/planes/{id}` y
    `DELETE /api/clases/{id}` responden 404 sin tocar nada. _(prueba obligatoria)_ (HU-19, sección 9.1)
14. **Estado del plan en America/Lima.** El `estado` de cada plan se calcula con la fecha de hoy en America/Lima (a
    partir de `RELOJ`, sin depender de la zona del servidor): `INACTIVO` si `activo` es falso; si no, `PROGRAMADO` si hoy
    es anterior a `vigenciaInicio`; `VENCIDO` si hoy es posterior a `vigenciaFin`; y `VIGENTE` en los demás casos (sin
    fechas, o hoy entre las dos, con los dos días incluidos). Es una función pura del dominio con pruebas unitarias en
    los bordes: con `vigenciaFin` 2026-11-29, a las `2026-11-30T04:59:59Z` (23:59:59 del 29 en Lima) es `VIGENTE` y a las
    `2026-11-30T05:00:00Z` (00:00 del 30 en Lima) es `VENCIDO`; lo mismo en el cambio de mes y de año, y con el proceso
    en otra zona horaria (`TZ=Asia/Tokyo`). Significado de la vigencia: pregunta N2. _(prueba obligatoria)_ (RNF-12)
15. **Lista de planes.** `GET /api/planes` responde 200 con `{ planes }`: todos los de la academia, activos e inactivos,
    ordenados por nombre en español (como la lista de usuarios de 002) y, a igual nombre, por id. _(prueba obligatoria)_

### D. Clases y aforo (HU-17, RN-09 a RN-11)

16. **Crear una clase.** Dado un `ADMIN` de A, cuando envía `POST /api/clases` con `crearClaseSchema` válido (nivel,
    día, hora de inicio, entrenador y aforo), entonces responde 201 con `{ clase }`, con `horaFin` una hora después de
    `horaInicio`, `activo: true` y el entrenador (`id`, `nombres`, `apellidos`, `activo`, sin DNI); y registra
    `CLASE_CREADA` (entidad `clase`) con `datosDespues`. _(prueba obligatoria)_ (HU-17)
17. **Bloques de 1 hora (RN-09).** `horaInicio` solo acepta `"08:00"`, `"09:00"`, …, `"19:00"`: `"07:00"`, `"20:00"`,
    `"08:30"`, `"8:00"`, `"08:00:00"` y `"24:00"` responden 400. La clase de las `"19:00"` termina a las `"20:00"`.
    `diaSemana` es un entero de 1 a 7 y `nivel` es `BASICO`, `INTERMEDIO` o `AVANZADO`. _(prueba obligatoria)_
18. **Aforo de 20 a 50 (RN-11).** `aforo` es un entero de 20 a 50, con los dos extremos incluidos, al crear y al editar:
    `19`, `51`, `0`, `-20`, `20.5`, `"30"` y `null` responden 400 sin escribir ni auditar, y la base lo vuelve a exigir
    (criterio 4). _(crítico)_ (RN-11, HU-17)
19. **Entrenador válido.** `entrenadorId` debe ser un usuario de la academia con rol `ENTRENADOR` y estado `ACTIVO`. Si
    no existe, es de otra academia, tiene otro rol o está inactivo, responde 409 `ENTRENADOR_NO_VALIDO`, con el mismo
    cuerpo en los cuatro casos, sin escribir ni auditar. Un `entrenadorId` que no es UUID responde 400. _(prueba
    obligatoria; el caso de otra academia es crítico en el criterio 6)_ (HU-17, RN-10)
20. **Clases en el mismo bloque (RN-10, HU-17).** Dadas clases activas de A:
    - a) en un mismo día y bloque se pueden crear clases de niveles distintos con entrenadores distintos;
    - b) si el entrenador ya tiene otra clase activa ese día en ese bloque, responde 409 `ENTRENADOR_OCUPADO` (HU-17);
    - c) si ya hay una clase activa del mismo nivel ese día en ese bloque, responde 409 `CLASE_DUPLICADA` (provisional,
      pregunta N3);
    - d) las clases inactivas no cuentan para b ni c;
    - e) si se cumplen b y c a la vez, responde `CLASE_DUPLICADA`;
    - f) dadas dos creaciones simultáneas que chocan por b o por c, exactamente una responde 201 y la otra 409, y queda
      una fila y una `CLASE_CREADA` (lo garantiza la base, no una consulta previa).

    _(prueba obligatoria)_ _(Las carreras con una clase que se desactiva o reactiva entre medio: criterio 32, ronda 1
    adversarial.)_
21. **Editar una clase.** `PATCH /api/clases/{id}` acepta solo `entrenadorId`, `aforo` y `activo` (al menos uno):
    `nivel`, `diaSemana`, `horaInicio` u otro campo responden 400 (provisional, pregunta N4). Cambiar el entrenador
    aplica los criterios 19 y 20 b; reactivar una clase (`activo: true`) exige que su entrenador esté activo (criterio
    19) y aplica 20 b y 20 c. Responde 200 con `{ clase }` y registra un solo `CLASE_ACTUALIZADA` con `datosAntes` y
    `datosDespues` de los campos que cambiaron; sin cambios, 200 sin escribir ni auditar. _(prueba obligatoria)_
    (HU-17, RNF-06)
22. **El cambio de aforo se ordena con el cupo.** Un `PATCH /api/clases/{id}` bloquea la fila de la clase con
    `bloquearClasesParaCupo` (criterio 23) justo después de `bloquearActorVigente` y antes de leerla, siempre (cambie o no
    el aforo). Pruebas deterministas, sin depender de tiempos:
    - a) una transacción de la prueba bloquea la clase (`SELECT … FOR UPDATE`) y cambia su aforo de 30 a 25 sin
      confirmar; el `ADMIN` envía `{ "aforo": 40 }`, que queda esperando (se comprueba en `pg_locks` o
      `pg_stat_activity`); la prueba confirma; entonces responde 200 con aforo 40 y su `CLASE_ACTUALIZADA` tiene
      `datosAntes.aforo` 25 (leyó después del bloqueo);
    - b) igual, pero el `ADMIN` envía `{ "aforo": 25 }`: responde 200 sin escribir ni auditar;
    - c) dos `ADMIN` envían a la vez aforos distintos sobre la misma clase: los dos responden 200 (nunca 500 ni
      `40P01`), el valor final es el de uno de ellos y las dos auditorías quedan encadenadas.

    _(crítico)_ (RN-11; regla "aforo y caja en transacciones sin carreras" de `CLAUDE.md`)
23. **Función común para el cupo.** `bloquearClasesParaCupo(tx, claseIds)` (sin Nest, en el módulo de clases, como
    `leerConfiguracion`) bloquea con **una sola sentencia** `… WHERE academia_id = tx.academiaId AND id = ANY(…) ORDER BY
    id FOR UPDATE` las clases pedidas y devuelve, por cada una que existe en la academia de la transacción, `id`,
    `nivel`, `diaSemana`, `horaInicio`, `horaFin`, `aforo`, `activo` y `entrenadorId`. Los ids de otra academia, los que
    no existen y los repetidos no devuelven nada de más ni fallan; con una lista vacía no ejecuta ninguna sentencia.
    Prueba de integración: con clases de A y de B, en `conAcademia(A)` devuelve solo las de A; dos transacciones que
    piden `[c1, c2]` y `[c2, c1]` a la vez terminan las dos, sin `40P01`. _(crítico)_ (RN-11; base de 005, 010, 018 y
    020)
24. **Lista de clases.** `GET /api/clases` responde 200 con `{ clases }`: todas las de la academia, activas e inactivas,
    ordenadas por día, hora de inicio y nivel (`BASICO`, `INTERMEDIO`, `AVANZADO`) y, a igualdad, por id; cada una con
    su entrenador y su estado (`entrenador.activo`). _(prueba obligatoria)_ (HU-17)
25. **Entrenador desactivado con clases.** Dado un entrenador con clases activas, cuando el administrador lo desactiva
    (`POST /api/usuarios/{id}/desactivar` de 002), entonces responde 200 como hoy (002 no cambia), sus clases siguen
    activas y `GET /api/clases` las muestra con `entrenador.activo: false`; un `PATCH` de esa clase que cambia solo el
    aforo se acepta; uno que le asigna otro entrenador activo se acepta (provisional, pregunta N6). _(prueba
    obligatoria)_

### E. Web

26. **Menú y rutas.** Dado un `ADMIN`, el inicio del panel muestra "Planes" y "Clases y horarios" (según
    `puede(rol, 'CONFIGURAR_PLANES_HORARIOS_AFORO')`), que llevan a `/panel/planes` y `/panel/clases`; a los demás roles
    no se les muestran y esas páginas responden con el mensaje de "sin permiso" de 002 (`RequierePermiso`). _(prueba
    obligatoria, de componentes)_
27. **Página de planes.** Lista los planes con nombre, precio en soles (`S/ 120.00`), veces por semana, clases por mes y
    estado (Vigente, Programado, Vencido o Inactivo). Un formulario crea y edita: casillas de los días (lunes a
    domingo), de las franjas (`08:00 a 09:00` … `19:00 a 20:00`) y de los niveles; fechas de vigencia opcionales; y
    activar o desactivar. Explica que el precio ya incluye IGV (D-03) y que un cambio de precio vale para inscripciones
    y renovaciones nuevas (HU-19). Valida con los esquemas compartidos antes de enviar y muestra junto a cada campo los
    errores 400 y 409 de la API. _(prueba obligatoria, de componentes)_
28. **Página de clases.** Muestra la semana como una grilla de días por bloques de 08:00 a 20:00 (en el celular, un día
    a la vez), con cada clase en su bloque: nivel, entrenador y aforo; las inactivas y las de entrenador inactivo,
    marcadas ("Inactiva", "Entrenador inactivo"). Un formulario crea una clase (nivel, día, bloque, entrenador entre los
    entrenadores activos de `GET /api/usuarios` y aforo, con la ayuda "de 20 a 50 alumnos") y edita el entrenador, el
    aforo y el estado. Muestra junto a cada campo los errores 400 y 409 (`ENTRENADOR_OCUPADO`, `CLASE_DUPLICADA`,
    `ENTRENADOR_NO_VALIDO`). _(prueba obligatoria, de componentes)_
29. **Lecciones de la 003 en los formularios.** Los formularios de planes y de clases cumplen lo que la 003 tuvo que
    corregir tras sus ataques: las claves de sus consultas incluyen la identidad de la sesión (criterio 28 de 003); el
    `PATCH` lleva solo los campos editados, calculados contra la base con la que se llenó el formulario y no contra una
    respuesta que llegó después (criterio 27 de 003); mientras se guarda, los campos quedan desactivados (criterio 31 de
    003) y se desbloquean apenas responde la escritura, sin esperar otras consultas (criterio 31 a de 003); y un error
    de una consulta en segundo plano no borra lo escrito (criterio 30 de 003). _(prueba obligatoria, de componentes)_

### F. Semilla y documentación

30. **Semilla.** `delfines` tiene un segundo entrenador inventado, dos planes de ejemplo (por ejemplo, "3 veces por
    semana", 12 clases, S/ 120.00, lunes, miércoles y viernes; y "2 veces por semana", 8 clases, S/ 90.00, martes y
    jueves; todas las franjas y niveles) y clases de ejemplo de los tres niveles, con dos en el mismo bloque.
    `tiburones` queda sin planes ni clases. Se puede ejecutar dos veces sin duplicar ni fallar. _(verificación del
    revisor)_
31. **Documentación.** `docs/arquitectura.md` documenta las tablas, `bloquearClasesParaCupo` y las "Reglas para las
    historias siguientes" de esta spec (cupo, precio, horas); el `README.md` y la guía de uso explican las dos
    pantallas. _(verificación del revisor)_

### G. Ronda 1 adversarial

Fallas encontradas en la ronda 1 del ataque (T13, 17/11/2026), agregadas antes de tocar el código. Origen de cada una:
"ataque ronda 1".

32. **Carreras en los choques de clases, nunca 500.** `POST /api/clases` y `PATCH /api/clases/{id}` (al reactivar una
    clase o al cambiarle el entrenador) responden siempre 409 `CLASE_DUPLICADA` o 409 `ENTRENADOR_OCUPADO`, o el 201 o
    200 si la operación termina siendo válida, y nunca 500, aunque la clase que provocó el choque se desactive o se
    reactive en otra transacción confirmada entre medio. Por ejemplo: a) dada una clase activa C del mismo nivel (o del
    mismo entrenador) en el bloque, un `POST` que choca con C mientras otra transacción confirma `activo = false` en C;
    b) lo mismo con un `PATCH` que reactiva una clase o le asigna el entrenador de C. En los dos casos la respuesta es
    uno de esos 409 o el éxito, y si es un éxito queda una sola fila nueva o cambiada con su `CLASE_CREADA` o
    `CLASE_ACTUALIZADA`; si es un 409, no se escribe ni se audita nada. El código del 409 se decide por la restricción
    que la base informa como violada (`clases_nivel_bloque_activo_key` → `CLASE_DUPLICADA`,
    `clases_entrenador_bloque_activo_key` → `ENTRENADOR_OCUPADO`), o reintentando la escritura, y no depende de releer
    las clases después del choque. Sin carrera, se mantienen los criterios 20 b a 20 f (incluido el 20 e: si chocan
    nivel y entrenador a la vez, `CLASE_DUPLICADA`). _(crítico)_ (RN-10, HU-17; criterios 20 f y 21; ataque ronda 1.
    Causa: el `POST` hace `INSERT … ON CONFLICT DO NOTHING` y busca el choque en otra sentencia, y el `PATCH` relee
    después del `23505`; si la clase que chocó ya no está activa, no encuentran nada y responden 500.)
33. **Más invariantes en la base (amplía el 4).** Dado un `INSERT` o `UPDATE` directo como `aquagestion_app` en su
    academia (los `CHECK` valen igual para el dueño de las tablas), entonces falla con `23514`:
    - a) `planes.precio = 'NaN'` (en PostgreSQL `NaN > 0` es verdadero, así que el `CHECK` del criterio 4 lo deja
      pasar);
    - b) `dias_permitidos`, `franjas_permitidas` o `niveles_aplicables` con más de una dimensión (por ejemplo
      `'{{1,2},{3,4}}'`) o con algún elemento `NULL` (por ejemplo `'{1,NULL,3}'` o `ARRAY['BASICO', NULL]`);
    - c) `vigencia_inicio` o `vigencia_fin` igual a `'infinity'` o `'-infinity'` (no finitas, `isfinite`).

    Con esas filas imposibles, `GET /api/planes` no puede volver a fallar por ellas: hoy un arreglo de dos dimensiones
    escrito así hace que responda 500 a toda la academia. _(crítico)_ (RN-25, D-03; criterio 4; ataque ronda 1)
34. **Nombres de plan que se ven iguales son el mismo (amplía el 11 y DR-8).** Antes de validar, guardar y comparar,
    el nombre del plan se normaliza: a NFC; los espacios Unicode (categoría `Zs`: no separable U+00A0, ideográfico
    U+3000, finos, etc.) pasan a un espacio normal; se eliminan los caracteres de formato invisibles (categoría `Cf`:
    ancho cero U+200B, U+200C, U+200D, U+2060, U+FEFF, guion suave U+00AD), salvo los de control bidireccional, que
    siguen respondiendo 400 como hoy (criterio 9, `textoVisibleSchema`); y se colapsan los espacios seguidos y se
    recortan los extremos. La unicidad sigue sin distinguir mayúsculas (criterio 11). Dado un plan de A llamado
    "Plan Mensual", cuando se crea o se renombra otro de A como `"Plan Men​sual"` o `"Plan ​Mensual"` (con
    un espacio de ancho cero, que no se ve), `"Plan Mensual"` (no separable), `"Plan　Mensual"` (ideográfico)
    o `"Plan  Mensual"` (dos espacios), entonces
    responde 409 `NOMBRE_PLAN_EN_USO` sin escribir ni auditar; lo mismo con "Natación" escrito en NFD (`a` + U+0301)
    contra "Natación" en NFC. El nombre que se guarda y se devuelve es el normalizado ("Plan Mensual" con un solo
    espacio normal), y los límites del criterio 9 (de 3 a 80 caracteres, 3 visibles) se miden sobre él. _(prueba
    obligatoria)_ (DR-8, DT-6 de 004; ataque ronda 1) _(Corregido y ampliado por los criterios 34 a y 34 b, ronda 2
    adversarial: el NFC va al final, no al principio, y se quitan todos los invisibles de `Default_Ignorable_Code_Point`.
    Donde este criterio y el 34 a o el 34 b difieran, mandan el 34 a y el 34 b.)_

### H. Ronda 2 adversarial

Fallas encontradas en la ronda 2 del ataque (17/11/2026), las dos en el criterio 34, que no es de ruta crítica; ninguna
en los criterios críticos. Agregadas antes de tocar el código. Origen de cada una: "ataque ronda 2". En los ejemplos,
los caracteres invisibles se escriben por su código (`"Plan Men" + U+034F + "sual"`), no pegados en el texto.

**34 a. El nombre guardado siempre queda en NFC (corrige el orden del 34).** `normalizarNombrePlan` aplica sus pasos
en este orden: 1) quita los caracteres invisibles (criterio 34 b), salvo los de control bidireccional; 2) pasa los
espacios Unicode (`Zs`) y el braille en blanco U+2800 a un espacio normal; 3) colapsa los espacios seguidos; 4) recorta
los extremos; y 5) por último, normaliza a NFC. (El orden de 1 y 2 puede invertirse, porque ningún carácter está en los
dos grupos; lo que no puede cambiar es que el NFC vaya al final.) Así, un invisible entre una letra y una tilde suelta
no impide que se compongan. Entonces:

- a) dado un plan de A llamado "Plan Natación" (NFC), cuando se crea o se renombra otro de A como
  `"Plan Natacio" + U+200B + U+0301 + "n"` (una `o`, un espacio de ancho cero y la tilde suelta), y lo mismo con U+00AD,
  U+FEFF o U+2060 en lugar de U+200B, responde 409 `NOMBRE_PLAN_EN_USO` sin escribir ni auditar;
- b) dado ese nombre en un plan nuevo de otra academia (o sin choque), se guarda y se devuelve "Plan Natación" en NFC
  (`nombre === nombre.normalize('NFC')`), nunca con la tilde suelta;
- c) la función es idempotente (`normalizarNombrePlan(normalizarNombrePlan(x)) === normalizarNombrePlan(x)`) y su
  resultado siempre está en NFC, para cualquier texto de entrada (prueba de propiedades o una lista amplia de casos);
- d) la web usa la misma función (no un `trim`) para preparar el nombre que envía y para decidir si el nombre cambió al
  editar (criterio 29), así que muestra, cuenta y envía lo mismo que guarda la API.

_(prueba obligatoria; no protegida)_ (DR-8, DT-6 y DT-7 de 004; criterio 34; ataque ronda 2)

**34 b. Más caracteres invisibles (amplía el 34).** Antes de comparar y guardar, además de los de formato (`Cf`) se
quitan todos los de la propiedad Unicode `Default_Ignorable_Code_Point`, salvo los de control bidireccional
(`Bidi_Control`), que siguen respondiendo 400 (criterio 9, `textoVisibleSchema`): entre otros, la unión de grafemas
U+034F, los selectores de variación U+FE00 a U+FE0F y U+E0100 a U+E01EF, los selectores mongoles U+180B a U+180F, U+17B4
y U+17B5, los rellenos de hangul U+115F, U+1160, U+3164 y U+FFA0, y las etiquetas U+E0000 a U+E0FFF. El braille en
blanco U+2800 cuenta como un espacio (criterio 34 a, paso 2). Los separadores de línea y de párrafo (U+2028, U+2029) no
son `Zs` ni se quitan: en medio del nombre siguen respondiendo 400 en `nombre`; al principio o al final los quita el
recorte (paso 4), como en la 001, porque el criterio 9 mide el nombre recortado _(precisado en la ronda 3)_. Dado un plan de A llamado "Plan Mensual", cuando se crea o se renombra
otro de A como `"Plan Men" + U+034F + "sual"` o `"Plan" + U+2800 + "Mensual"`, entonces responde 409
`NOMBRE_PLAN_EN_USO` sin escribir ni auditar; lo mismo con `"Plan Mensual" + U+FE0F` y `"Plan Men" + U+180B + "sual"`.
Un nombre con U+202E o U+200F sigue respondiendo 400 en `nombre`. _(prueba obligatoria; no protegida)_ (DR-8, DT-7 de
004; criterio 34; ataque ronda 2)

### I. Ronda 3 adversarial

Ronda de confirmación (19/11/2026): sin fallas en los criterios de ruta crítica ni regresiones. Una falla menor en los
criterios 11 y 34 (letras sin forma precompuesta en mayúscula o minúscula) se acepta como riesgo (ver "Riesgos
aceptados"). Origen de lo que sigue: "ataque ronda 3".

- **Precisión del 34 b:** U+2028 y U+2029 dan 400 en `nombre` solo en medio del nombre; al principio o al final los quita
  el recorte (ya incorporado en el texto del 34 b).

**34 c. Mayúsculas acentuadas en la unicidad (amplía el 11).** Dado un plan de A llamado "Natación Libre", cuando se crea
o se renombra otro de A como "NATACIÓN LIBRE", "natación libre" o "PLAN ÑANDÚ" frente a "plan ñandú" (cualquiera de las
letras á é í ó ú ü ñ en mayúscula o minúscula), entonces responde 409 `NOMBRE_PLAN_EN_USO` sin escribir ni auditar. La
prueba de integración corre contra la base de las pruebas y falla si la base se creó con un `LC_CTYPE` en el que
`lower()` no cambia las letras acentuadas (`C` o `POSIX`), que es el requisito de entorno de "Riesgos aceptados".
_(prueba obligatoria; no protegida)_ (DR-8; criterios 11 y 34; ataque ronda 3)

## Casos límite

- **La clase de 19:00 a 20:00:** es el último bloque válido; `"20:00"` como inicio responde 400 (criterio 17).
- **Aforo 20 y 50:** se aceptan; 19 y 51 no (criterio 18).
- **Precio con ceros:** `"120"`, `"120.0"` y `"120.00"` son el mismo precio y se devuelven `"120.00"`. Cambiar `"120"` por
  `"120.00"` no es un cambio (200 sin auditoría).
- **Un plan de 7 veces por semana:** exige los 7 días permitidos (criterio 9).
- **Vigencia de un solo día:** `vigenciaInicio` igual a `vigenciaFin` es válido; el plan es `VIGENTE` ese día en Lima.
- **Plan vencido o inactivo:** se sigue viendo y editando; las historias siguientes deciden qué se ofrece (pregunta N2).
- **Desactivar y reactivar una clase:** al reactivar se vuelven a comprobar el entrenador y los choques del bloque; si
  mientras tanto se creó otra clase igual, responde 409 (criterio 21).
- **Mismo entrenador, mismo bloque, días distintos:** se permite (el bloque es de un día concreto).
- **Entrenador que cambia de rol:** no ocurre; el rol de una cuenta no se cambia (criterio 2 de 002).
- **Hora del servidor en otra zona:** las horas de las clases son horas locales de Lima sin zona (`time`); el estado
  del plan se calcula con la fecha de Lima (criterio 14). La 009 compone la fecha de Lima y la hora de la clase.
- **Ids en mayúsculas:** un UUID en mayúsculas en la dirección se trata igual que en minúsculas. _(Implementación,
  AT-2: lo normaliza el servicio, no `IdDeRuta`.)_
- **La clase que chocó deja de estar activa a mitad de la escritura:** 409 por la restricción violada, o el éxito si
  la escritura se reintenta y ya no choca; nunca 500 (criterio 32).
- **Precio `NaN`, arreglos de dos dimensiones o con `NULL`, vigencia infinita:** la API ya no los acepta (criterios 9 y
  10); la base tampoco, aunque se escriba directo (criterio 33).
- **Nombre que, normalizado, queda con menos de 3 caracteres visibles** (por ejemplo, dos letras y espacios de ancho
  cero): 400 en `nombre` (criterios 9 y 34).
- **Renombrar un plan solo con espacios invisibles o en NFD** ("Plan Mensual" a `"Plan Mensual"`): el nombre
  normalizado es el mismo, así que es un `PATCH` sin cambios (200 sin escribir ni auditar, criterio 12).
- **Invisible entre una letra y su tilde suelta** (`"Natacio" + U+200B + U+0301 + "n"`): se quita el invisible y después
  se compone en NFC; choca con "Natación" (criterio 34 a).
- **Nombre con emojis compuestos o selectores de variación** (una familia unida con U+200D, un corazón con U+FE0F): se
  guardan sin U+200D ni U+FE0F, como emojis sueltos (criterio 34 b; ver "Riesgos aceptados").
- **Braille en blanco entre palabras** (`"Plan" + U+2800 + "Mensual"`): cuenta como un espacio y choca con
  "Plan Mensual" (criterio 34 b).
- **Separador de línea o de párrafo** (U+2028, U+2029): en medio del nombre, 400 en `nombre`; al principio o al final,
  lo quita el recorte y el nombre se acepta (criterio 34 b, precisado en la ronda 3).
- **Letras sin forma precompuesta en mayúscula o minúscula** ("Plan ǰota" frente a "PLAN J̌OTA"): no chocan (ver
  "Riesgos aceptados", ronda 3). Las letras del español, el quechua y el aymara sí chocan (criterio 34 c).

## Reglas de negocio aplicables

- **RN-07 y HU-19:** los planes los define el administrador con nombre, veces por semana, clases por mes, duración,
  precio, días y franjas permitidos, niveles, vigencia y estado. Ejemplo de referencia: 3 veces por semana, 12 clases.
- **HU-19:** los cambios de precio aplican solo a matrículas nuevas o renovaciones.
- **D-03:** el precio del plan es el monto final con IGV; no se suma ni se resta nada.
- **RN-25:** cobro proporcional = precio ÷ clases por mes × clases restantes (lo calcula la 005).
- **RN-09 y HU-17:** clases de 08:00 a 20:00 en bloques de 1 hora.
- **RN-10 y HU-17:** clases de distinto nivel en el mismo bloque, cada una con su entrenador; un entrenador no tiene dos
  clases en el mismo bloque.
- **RN-11 y HU-17:** aforo editable de 20 a 50; no se permiten inscripciones por encima del aforo; si se reduce por
  debajo de los inscritos, el sistema advierte (pregunta N5).
- **D-15:** el nivel general del alumno decide en qué clases puede inscribirse (lo usa la 005).
- **Sección 2.1:** "Configurar planes, horarios y aforo" solo el administrador.
- **D-23 y D-29:** todo es por academia; el Superadmin no lo ve.
- **RN-22 y RNF-06:** auditoría de quién cambió qué y cuándo (aquí se audita todo cambio de planes y clases, decisión
  D9).
- **Reglas para las historias siguientes de `docs/arquitectura.md`:** `bloquearActorVigente` como primera sentencia;
  `@Permiso` en cada manejador; cada paso con `await`; varias filas con una sola sentencia; montos en `numeric` y
  `Decimal`; fechas en America/Lima; sin caché en los servicios; errores de la base con `errorParaRegistro`.

## Contrato

### Rutas

Mismas reglas que 002 y 003: `Cache-Control: no-store`, cuerpos JSON con esquemas estrictos y las reglas de cuerpos de
001; orden de comprobaciones sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación. Todas con
`@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')`.

| Método y ruta | Entrada | Éxito | Errores |
| --- | --- | --- | --- |
| `GET /api/planes` | — | 200 `RespuestaListaPlanes` | 401, 403 |
| `POST /api/planes` | `crearPlanSchema` | 201 `RespuestaPlan` | 400, 401, 403, 409 `NOMBRE_PLAN_EN_USO` |
| `PATCH /api/planes/{id}` | `actualizarPlanSchema` | 200 `RespuestaPlan` | 400, 401, 403, 404, 409 `NOMBRE_PLAN_EN_USO` |
| `GET /api/clases` | — | 200 `RespuestaListaClases` | 401, 403 |
| `POST /api/clases` | `crearClaseSchema` | 201 `RespuestaClase` | 400, 401, 403, 409 `ENTRENADOR_NO_VALIDO`, `CLASE_DUPLICADA`, `ENTRENADOR_OCUPADO` |
| `PATCH /api/clases/{id}` | `actualizarClaseSchema` | 200 `RespuestaClase` | 400, 401, 403, 404, 409 (los tres de arriba) |

El 401 de `POST` y `PATCH` incluye el caso del criterio 7. El 404 es `NO_ENCONTRADO` (id que no existe, de otra
academia o que no es UUID). Orden de los errores de negocio, después del 400 del esquema y del 401 del criterio 7: en
planes, 404 → 400 de las reglas que cruzan campos con lo guardado (criterio 12) → `NOMBRE_PLAN_EN_USO`; en clases, 404
→ `ENTRENADOR_NO_VALIDO` → `CLASE_DUPLICADA` → `ENTRENADOR_OCUPADO`. En `POST /api/planes`, las reglas que cruzan
campos van en el esquema (llegan todos los campos).

_(Implementación, AT-2.)_ El `{id}` de los dos `PATCH` no pasa por `IdDeRuta`: lo valida el servicio después de
`bloquearActorVigente`, así que el orden queda 401 de sesión → 403 → 400 del cuerpo → 401 del criterio 7 → 404, y un
id que no es UUID responde exactamente el mismo 404 que uno que no existe o que es de otra academia.

_(Implementación, AT-4.)_ En los 400 de los arreglos (`diasPermitidos`, `franjasPermitidas`, `nivelesAplicables`),
`detalles.errores[].campo` es el campo con el índice cuando el error es de un elemento (`diasPermitidos.2`,
`franjasPermitidas.0`, `nivelesAplicables.0`: valor fuera de rango, texto que no es un bloque, nivel desconocido o tipo
incorrecto) y el nombre de la lista cuando es de la lista entera (vacía, con repetidos, o con menos días que
`vecesPorSemana`).

### Esquemas compartidos

- `packages/contratos/src/horario.ts`: `nivelNatacionSchema` (`BASICO`, `INTERMEDIO`, `AVANZADO`, con `NIVELES` en ese
  orden; lo reutilizarán la 005 y la 013), `diaSemanaSchema` (entero de 1 a 7, con `DIAS_SEMANA` y sus nombres),
  `horaBloqueSchema` (`"08:00"` a `"19:00"`, con `BLOQUES` y `horaFinDe`), `fechaSchema` (`AAAA-MM-DD`, fecha real).
- `packages/contratos/src/dinero.ts`: `montoSchema` (texto, hasta dos decimales, mayor que 0, hasta `"99999.99"`;
  criterio 10), que reutilizarán la 005 a la 007.
- `packages/contratos/src/planes.ts`: `crearPlanSchema` (estricto: `nombre`, `vecesPorSemana`, `clasesPorMes`,
  `duracionMinutos` opcional, `precio`, `diasPermitidos`, `franjasPermitidas`, `nivelesAplicables`, `vigenciaInicio` y
  `vigenciaFin` opcionales o `null`), `actualizarPlanSchema` (estricto, todo opcional más `activo`, al menos un campo),
  `estadoPlanSchema` (`VIGENTE`, `PROGRAMADO`, `VENCIDO`, `INACTIVO`), `planSchema` (los campos, `id`, `activo` y
  `estado`), `respuestaPlanSchema` (`{ plan }`) y `respuestaListaPlanesSchema` (`{ planes }`), con sus límites
  exportados para la web. _(Ronda 1, criterio 34, DT-6.)_ El `nombre` de `crearPlanSchema` y `actualizarPlanSchema` se
  normaliza en el propio esquema antes de sus validaciones, con una función pura exportada (`normalizarNombrePlan`),
  para que la web valide y muestre lo mismo que guarda la API. _(Ronda 2, criterios 34 a y 34 b, DT-7: el orden de los
  pasos, con el NFC al final, y los caracteres que se quitan.)_
- `packages/contratos/src/clases.ts`: `crearClaseSchema` (estricto: `nivel`, `diaSemana`, `horaInicio`, `entrenadorId`,
  `aforo`), `actualizarClaseSchema` (estricto: `entrenadorId`, `aforo` y `activo` opcionales, al menos uno),
  `AFORO_MINIMO` 20 y `AFORO_MAXIMO` 50, `claseSchema` (`id`, `nivel`, `diaSemana`, `horaInicio`, `horaFin`, `aforo`,
  `activo`, `entrenador: { id, nombres, apellidos, activo }`), `respuestaClaseSchema` y `respuestaListaClasesSchema`.

### Para las historias siguientes (backend)

```ts
// backend/src/modulos/clases/cupo.ts (reexportada en clases/index.ts). Sin Nest.
interface ClaseBloqueada { id: string; nivel: NivelNatacion; diaSemana: number; horaInicio: string;
  horaFin: string; aforo: number; activo: boolean; entrenadorId: string }
// Bloquea con una sola sentencia, ORDER BY id FOR UPDATE, las clases de tx.academiaId que estén en claseIds.
function bloquearClasesParaCupo(tx: TransaccionAcademia, claseIds: readonly string[]): Promise<ClaseBloqueada[]>;
```

### Auditoría

- `PLAN_CREADO` y `PLAN_ACTUALIZADO` (entidad `plan`) y `CLASE_CREADA` y `CLASE_ACTUALIZADA` (entidad `clase`), con
  `entidadId` el id, actor `USUARIO` con su id e IP. En las actualizaciones, `datosAntes` y `datosDespues` solo con los
  campos que cambiaron, con los nombres y formatos de la API (precio como texto con dos decimales).

### Códigos de error nuevos

`NOMBRE_PLAN_EN_USO` (409), `ENTRENADOR_NO_VALIDO` (409), `CLASE_DUPLICADA` (409) y `ENTRENADOR_OCUPADO` (409). Se
reutilizan `SOLICITUD_INVALIDA`, `NO_ENCONTRADO` y los de sesión y permisos de 002.

### Eventos

Ninguno.

## Cambios al modelo de datos

Una migración `<marca>_planes_clases`. Ajusta las entidades `PLAN` y `CLASE` de la sección 9.1: se agrega
`academia_id` (D-23), `duracion_min` pasa a `duracion_minutos` y se agregan `creado_en` y `actualizado_en`.

- **Tipo `nivel_natacion`:** `BASICO`, `INTERMEDIO`, `AVANZADO` (lo reutilizarán el alumno, 005, y las evaluaciones,
  013).
- **`planes`** (por academia): `id uuid` PK; `academia_id uuid not null` → `academias(id)` (`RESTRICT`);
  `nombre text not null`; `veces_por_semana smallint not null` (1 a 7); `clases_por_mes smallint not null` (≥ 1);
  `duracion_minutos smallint not null default 60` (> 0); `precio numeric(10,2) not null` (> 0);
  `dias_permitidos smallint[] not null` (no vacío, cada uno de 1 a 7, al menos `veces_por_semana` elementos);
  `franjas_permitidas time(0)[] not null` (no vacía, cada una un bloque de 08:00 a 19:00);
  `niveles_aplicables nivel_natacion[] not null` (no vacío); `vigencia_inicio date null`; `vigencia_fin date null`
  (≥ `vigencia_inicio` si las dos existen); `activo boolean not null default true`; `creado_en`, `actualizado_en`.
  `UNIQUE (academia_id, id)`; índice único `(academia_id, lower(nombre))` (pregunta N8).
- **`clases`** (por academia): `id uuid` PK; `academia_id uuid not null` → `academias(id)` (`RESTRICT`);
  `nivel nivel_natacion not null`; `dia_semana smallint not null` (1 a 7); `hora_inicio time(0) not null` (bloque de
  08:00 a 19:00); `hora_fin time(0) not null` (= `hora_inicio + 1 hora`); `entrenador_id uuid not null`, con
  `FOREIGN KEY (academia_id, entrenador_id) REFERENCES usuarios (academia_id, id)` (`RESTRICT`); `aforo smallint not
  null` (`CHECK (aforo BETWEEN 20 AND 50)`); `activo boolean not null default true`; `creado_en`, `actualizado_en`.
  `UNIQUE (academia_id, id)`; índices únicos parciales `(academia_id, entrenador_id, dia_semana, hora_inicio) WHERE
  activo` (criterio 20 b) y `(academia_id, nivel, dia_semana, hora_inicio) WHERE activo` (criterio 20 c, pregunta N3);
  índice `(academia_id, dia_semana, hora_inicio)`.
- **RLS** activada y forzada en las dos, con políticas de `SELECT`, `INSERT` y `UPDATE` de la forma exacta del criterio
  132 de 001. Sin política ni privilegio de `DELETE`.
- **Privilegios** de `aquagestion_app`: criterio 2.
- Los `CHECK` del criterio 4 van a mano en la migración (Prisma no los genera). Los límites provisionales de la API
  (`clasesPorMes` ≤ 31, `duracionMinutos` de 15 a 60, precio ≤ 99 999.99, nombre de 3 a 80) no van a la base
  (decisión D3).
- _(Ronda 1, criterio 33.)_ Una migración nueva `<marca>_planes_clases_invariantes` (no se edita la ya aplicada)
  reemplaza o suma `CHECK` en `planes`: precio distinto de `NaN`; los tres arreglos de una sola dimensión y sin
  elementos `NULL`; `vigencia_inicio` y `vigencia_fin` finitas cuando no son nulas. Sin cambios de columnas, índices,
  políticas ni privilegios. La normalización del nombre (criterio 34) no cambia la base: el índice único sigue sobre
  `lower(nombre)`.
- _(Ronda 3.)_ Sin cambios al modelo. El índice de `lower(nombre)` exige que la base tenga un `LC_CTYPE` UTF-8
  (requisito de entorno de "Riesgos aceptados"; criterio 34 c).

## Fuera de alcance

- **Inscritos, reservas de cupo y ocupación de las clases:** las crea la 005, primera historia con inscritos (pregunta
  T1). Con ellas llegan la advertencia al reducir el aforo por debajo de los inscritos (HU-17, pregunta N5), lo que
  pasa al desactivar una clase con inscritos y los cupos restantes de HU-02.
- **Mostrar planes y clases al público** (formulario de inscripción): 005. **A la secretaria:** donde los use (005,
  007, 010; pregunta N7). **Al entrenador** (su horario, HU-18): 012.
- **Cobro proporcional y elección de días y horario:** 005 (RN-25, HU-02). Qué clases puede elegir un plan (días,
  franjas y niveles permitidos) lo aplica la 005.
- **Datos propios del entrenador** (teléfono, especialidad): 012.
- **Días de cierre y recuperaciones:** 017 y 018.
- **Clases particulares:** 016.
- **Ocupación de aforo como reporte (R11):** Fase 3.
- **Borrar planes o clases:** no; se desactivan (criterio 13).

## Impacto en especificaciones anteriores

- **001, criterio 2 y `PRIVILEGIOS_APP` (criterio 102):** la lista exacta suma los privilegios de `planes` y `clases`
  (criterio 2). Las pruebas protegidas que comparan la lista exacta las actualiza el test-writer en el commit de pruebas
  protegidas de 004, solo para sumar, sin quitar nada de lo que comprueban; `scripts/lib/rol-app.mjs` se amplía igual.
- **001, criterio 10:** no cambia (las tablas nuevas tienen `academia_id`). Criterio 12: la llave compuesta hacia
  `usuarios` lo cumple.
- **002, criterio 26 (matriz):** no cambia (DT-2: se reutiliza `CONFIGURAR_PLANES_HORARIOS_AFORO`).
- **002, desactivar usuarios:** no cambia (pregunta N6). Su bloqueo de las dos filas de `usuarios` ordenadas por id
  obligó a que `POST` y `PATCH` de clases bloqueen al entrenador junto con el actor (AT-1).
- **002, criterio 45 (prueba protegida de la semilla, `backend/test/integracion/semilla/semilla-usuarios.test.ts`):** el
  segundo entrenador del criterio 30 (DNI `10000005`, inventado) cambia lo que comprueba: 5 usuarios en `delfines`, 6
  en total y dos `ENTRENADOR` (`10000003` y `10000005`). La actualiza el test-writer en un commit "Pruebas protegidas
  (004): …", solo para sumar el segundo entrenador, sin quitar nada de lo que comprueba; el entrenador no entra a la
  semilla antes de ese commit (AT-5).
- **001, criterio 127 (dependencias permitidas del backend):** `date-fns` y `@date-fns/tz` se suman a
  `DEPENDENCIAS_BACKEND_PERMITIDAS` de `scripts/lib/dependencias-backend.mjs` (AT-3). Ya eran parte del stack (D-25).
- **002, "Fuera de alcance: datos propios del entrenador (… asignación a clases): 004 y 012":** la asignación se cumple
  aquí; el resto sigue en 012.
- **003:** ninguno.
- **Web de 002:** el inicio del panel suma dos opciones con el mismo permiso; la lista de opciones de `PaginaPanel` deja
  de usar el permiso como clave de React.
- **`docs/arquitectura.md`:** nuevas "Reglas para las historias siguientes" (criterio 31).

## Reglas para las historias siguientes

Para documentar en `docs/arquitectura.md` (criterio 31):

- **Cupo de una clase.** Toda operación que ocupa, libera o mueve cupos (inscripción y su reserva, renovación,
  recuperación, cambio de horario, asistencia en otro horario) y todo cambio del aforo o del estado de una clase llama a
  `bloquearClasesParaCupo(tx, ids)` con todas las clases que toca, en una sola llamada, después de
  `bloquearActorVigente` (si hay actor) y antes de contar ocupación o escribir. Así dos operaciones sobre el último cupo
  se ordenan, y ninguna cuenta con un aforo viejo. Nunca se bloquea una clase y después una fila de `usuarios` con
  `FOR UPDATE` o `FOR SHARE`.
- **Precio y clases del mes.** La matrícula (005, 007, 010) guarda su propio monto y sus clases totales al crearse
  (`monto_calculado`, `clases_totales` de la sección 9.1); nunca los vuelve a leer del plan. Así un cambio del plan vale
  solo para matrículas nuevas y renovaciones (HU-19).
- **Horas de las clases.** `hora_inicio` y `hora_fin` son horas locales de Lima sin zona. Para saber si una clase ya
  empezó, se compone la fecha de Lima con la hora en America/Lima (`@date-fns/tz`), nunca con la zona del servidor.

## Riesgos aceptados

- **Hasta la 005, el aforo no se compara con nada:** no hay inscritos. Lo que sí queda es el rango, el bloqueo común y
  la regla para las historias siguientes; la 005 trae las pruebas de "nunca más inscritos que el aforo".
- **Clases con un entrenador inactivo** (pregunta N6): el administrador las ve marcadas y las reasigna. No afecta al
  aforo ni al dinero.
- **El último en guardar el mismo campo gana:** dos administradores que cambian el mismo campo a la vez no se avisan;
  los dos cambios quedan en la auditoría, encadenados (criterios 12 y 22 c).
- **Arreglos sin repetidos solo en la API:** la base exige el rango, que no estén vacíos, una sola dimensión y ningún
  `NULL` (criterio 33), pero no que no haya repetidos ni que estén ordenados; solo una escritura directa en la base
  podría guardarlos, y la API los muestra tal como están.
- **Nombres parecidos que no son iguales (criterio 34):** la normalización une lo que Unicode considera el mismo texto
  o un espacio invisible, pero no las letras de otros alfabetos que se parecen (una `а` cirílica frente a una `a`
  latina); esos nombres se aceptan como distintos. La normalización vive en la API y en la web: una escritura directa
  en la base podría guardar un nombre sin normalizar. _(Ronda 2: los rellenos de hangul que la ronda 1 dejaba aquí
  pasan al punto siguiente.)_
- **Efectos de quitar los invisibles (criterio 34 b, ronda 2):** quitar U+200D y los selectores de variación separa
  los emojis compuestos de un nombre de plan: "Plan" seguido de la familia de tres personas (tres emojis unidos con
  U+200D) se guarda como tres emojis sueltos, y un corazón con U+FE0F pierde su selector. Los rellenos de hangul (U+3164, U+1160, U+115F, U+FFA0), que la ronda 1 aceptaba como distintos, ya no
  cuentan como visibles (criterio 87 de 001) y ahora, por ser `Default_Ignorable_Code_Point`, se quitan del nombre sin
  dejar un espacio en su lugar: `"Plan" + U+3164 + "Mensual"` queda `"PlanMensual"`, que no choca con "Plan Mensual". Se acepta
  porque nadie escribe así un nombre de plan en una academia peruana y nunca se muestran dos nombres que se vean iguales.
- **Ligaduras de compatibilidad (criterio 34 a):** se eligió NFC y no NFKC, así que `"Plan Proﬁ"` (con la ligadura
  U+FB01 "ﬁ") no se unifica con `"Plan Profi"` y se acepta como distinto. NFKC uniría además superíndices, anchos
  completos y otros caracteres que sí se ven distintos.
- **Filas imposibles para la web escritas directo en la base (D3):** la base admite precios hasta 99 999 999.99
  (`numeric(10,2)`) y años de 5 cifras en `vigencia_inicio` y `vigencia_fin`; la API solo los produce dentro de los
  límites de DR-1. Si alguien escribe directo en la base un precio mayor que 99 999.99 o una fecha con año de 5 cifras,
  la web rechaza la respuesta de `GET /api/planes` (no cumple `respuestaListaPlanesSchema`) y la página de planes de
  esa academia muestra un error hasta que se corrija la fila. Una fecha antes de Cristo escrita directo se mostraría
  como si fuera después de Cristo. Ninguna de las dos se puede escribir por la API.
- **`lower()` sobre letras sin forma precompuesta (criterios 11 y 34; ataque ronda 3, decisión del orquestador):** la
  unicidad compara `lower(nombre)` sobre el nombre ya en NFC. Para las letras que no tienen forma precompuesta en
  mayúscula o en minúscula (ǰ y J̌, ẖ y H̱, ẗ, ẘ, ẙ, ẛ y algunas griegas con diacríticos), `lower()` deja un texto que
  no está en NFC, así que "Plan ǰota" y "PLAN J̌OTA" no chocan y se aceptan como dos planes. No afecta a ninguna letra
  del español, el quechua ni el aymara (á é í ó ú ü ñ), que sí chocan (criterio 34 c). Alternativa descartada por
  ahora: un índice único sobre `normalize(lower(nombre), NFC)` (otra migración, y ata el índice a la versión de Unicode
  de PostgreSQL, como se dijo en DT-6).
- **Requisito de entorno: `LC_CTYPE` UTF-8 en la base (criterios 11 y 34 c; ataque ronda 3):** el índice único usa
  `lower()` de PostgreSQL, que depende del `LC_CTYPE` de la base. Con el locale `C` o `POSIX`, `lower('Ó')` no cambia y
  "NATACIÓN" y "natación" no chocarían. Requisito: las bases se crean con un `LC_CTYPE` UTF-8 (`C.UTF-8` o
  `en_US.utf8`), como la de la nube y la de la imagen Docker del responsable. La prueba de integración no protegida del
  criterio 34 c lo detecta si alguna base no lo cumple.

## Decisiones

**Cómo se citan.** Las decisiones del responsable de esta spec se citan como "DR-n" en esta sección y como "DR-n de
004" fuera de ella; las del orquestador, "DT-n" y "DT-n de 004". Los criterios, el contrato y las demás secciones se
escribieron antes de la aprobación y no cambian: donde dicen "pregunta Nn" se refieren a DR-n de 004 y donde dicen
"pregunta Tn", a DT-n de 004. Los valores que la spec llama "provisionales" (límites de N1 en los criterios 9 y 10, una
clase por nivel y bloque del criterio 20 c, campos inmutables del criterio 21, entrenador inactivo del criterio 25 y
nombre único del criterio 11) quedan aprobados para el MVP.

### Decisiones del responsable (17/11/2026)

Bryan aprobó la especificación y aceptó la propuesta de cada pregunta de negocio ("Estoy de acuerdo con tus
sugerencias"). Se conserva el texto de cada pregunta y su propuesta, que es lo decidido.

- **DR-1 (pregunta N1). Límites de los planes.** Los documentos dicen los campos, pero no sus límites. **Decidido (la
  propuesta):** nombre de 3 a 80 caracteres; de 1 a 7 veces por semana; de 1 a 31 clases por mes; duración de 15 a 60
  minutos, 60 por defecto (es informativa: la clase ocupa su bloque de 1 hora, RN-09); precio mayor que S/ 0 y hasta
  S/ 99 999.99, con céntimos; la academia puede tener clases de lunes a domingo (criterios 9, 10 y 17).
- **DR-2 (pregunta N2). ¿Qué significa la vigencia del plan?** **Decidido (la propuesta):** las fechas entre las que el
  plan se puede elegir para inscripciones nuevas y renovaciones (por ejemplo, un plan de verano de enero a marzo); las
  dos son opcionales (sin inicio, desde ya; sin fin, sin límite); no afecta a las matrículas que ya se pagaron. En esta
  historia solo se guarda y se muestra como estado (criterio 14); lo aplican la 005 y la 010.
- **DR-3 (pregunta N3). ¿Puede haber dos clases del mismo nivel en el mismo bloque** (por ejemplo, dos grupos de Básico
  a las 18:00 con dos entrenadores)? RN-10 habla de una clase de cada nivel. **Decidido (la propuesta):** no, como mucho
  una por nivel en cada bloque (hasta tres a la vez); así el alumno elige nivel, día y hora sin ambigüedad. Si luego
  hace falta, se quita la regla sin tocar los datos (criterio 20 c).
- **DR-4 (pregunta N4). ¿Se puede cambiar el nivel, el día o la hora de una clase ya creada?** **Decidido (la
  propuesta):** no; solo el entrenador, el aforo y si está activa. Para moverla, se desactiva y se crea otra. Cuando
  haya alumnos, mover una clase es cambiar el horario de cada uno, que tiene su propio flujo con motivo y auditoría
  (HU-03, 010) (criterios 2 y 21, decisión D7).
- **DR-5 (pregunta N5). Reducir el aforo por debajo de los inscritos** (HU-17: "el sistema advierte"). **Decidido (la
  propuesta):** se permite con una confirmación explícita; nadie pierde su lugar, y no entran inscripciones nuevas
  hasta que haya cupo. Desactivar una clase con inscritos no se permite hasta moverlos. Se construye en la 005, que es
  la primera con inscritos (nota de la 005 en `specs/backlog.md`).
- **DR-6 (pregunta N6). Entrenador desactivado con clases activas.** **Decidido (la propuesta):** se permite
  desactivarlo (la 002 no cambia); sus clases siguen activas y se marcan "Entrenador inactivo" para que el
  administrador las reasigne. Una clase nueva, una reasignación o una reactivación exigen un entrenador activo
  (criterios 19, 21 y 25). Alternativa descartada: no dejar desactivarlo mientras tenga clases.
- **DR-7 (pregunta N7). ¿Quién ve los planes y las clases en esta historia?** **Decidido (la propuesta):** solo el
  administrador, que es quien los configura (sección 2.1). La secretaria los verá donde los usa (inscripción y cobro,
  005 y 007; cambio de horario, 010), el entrenador su horario (HU-18, 012) y el público los planes vigentes y las
  clases con cupo (005) (criterio 5).
- **DR-8 (pregunta N8). ¿El nombre del plan es único en la academia?** **Decidido (la propuesta):** sí, sin distinguir
  mayúsculas y contando los inactivos, para que los reportes y el formulario de inscripción no muestren dos planes
  iguales (criterio 11).

### Decisiones técnicas del orquestador (17/11/2026)

El orquestador aprobó las cinco propuestas técnicas tal como estaban. Se conserva el texto de cada pregunta y su
propuesta.

- **DT-1 (pregunta T1). Ocupación y reservas en la 005, no aquí.** "Nunca más inscritos que el aforo" necesita algo que
  cuente inscritos, y eso nace con la solicitud de inscripción y su reserva de cupo (RN-28, 005); crear ahora una tabla
  de matrículas sería adelantar el diseño de la 005 (D-17). **Decidido (la propuesta):** la 004 deja el rango, el
  bloqueo común (`bloquearClasesParaCupo`) y la regla para las historias siguientes; la 005 cuenta la ocupación dentro
  de ese bloqueo, reserva los cupos y trae las pruebas protegidas del último cupo simultáneo y lo de DR-5. Quedó
  anotado en la nota de la 005 de `specs/backlog.md`.
- **DT-2 (pregunta T2). Permiso.** **Decidido (la propuesta):** las seis rutas usan `CONFIGURAR_PLANES_HORARIOS_AFORO`
  (también las lecturas, DR-7); la matriz sigue con 24 filas y la prueba protegida del criterio 26 de 002 no cambia.
  Alternativa descartada: un permiso de lectura nuevo para la secretaria (no hace falta con DR-7).
- **DT-3 (pregunta T3). Montos como texto en el JSON** (D3), con `montoSchema` en los contratos para todas las
  historias de dinero. **Decidido (la propuesta).**
- **DT-4 (pregunta T4). Entrenadores para el formulario.** **Decidido (la propuesta):** se reutiliza `GET /api/usuarios`
  (`GESTIONAR_USUARIOS`, que el administrador ya tiene) y la web filtra los entrenadores activos. Alternativa
  descartada por ahora: una ruta propia que devuelva solo id y nombre, si algún día otro rol tiene que elegir
  entrenadores.
- **DT-5 (pregunta T5). Clasificación.** **Decidido (la propuesta):** "en parte", con críticos 1 a 7, 10, 18, 22 y 23
  (sección "Clasificación de ruta crítica"). _(Ronda 1 adversarial: se suman 32 y 33 como críticos; 34 no lo es.)_

### Decisiones de la ronda 1 adversarial (17/11/2026)

- **DT-6. Normalización del nombre del plan (criterio 34).** Decisión técnica del orquestador para cumplir DR-8 ("sin
  distinguir mayúsculas", para que no se muestren dos planes iguales), no una regla de negocio nueva: dos nombres que
  se ven iguales son el mismo. Se normaliza en el esquema zod del contrato (`packages/contratos/src/planes.ts`), no
  solo en el servicio, para que la web valide, cuente los caracteres y muestre el mismo nombre que guarda la API y
  para que el `PATCH` compare lo normalizado con lo guardado. Los controles bidireccionales siguen respondiendo 400 en
  vez de eliminarse, para no debilitar el criterio 9 ni las reglas de texto de 001 (`textoVisibleSchema`, que no
  cambia para los demás campos). Alternativas descartadas: normalizar solo en el servicio (la web contaría otra
  longitud y no sabría por qué choca); un índice único sobre `normalize(lower(nombre), NFC)` en la base (no resuelve
  los espacios ni los caracteres de formato, y ata el índice a la versión de Unicode de PostgreSQL).
- **Corrección del criterio 32.** El 409 se decide por el nombre de la restricción del error de la base (el que da el
  adaptador, nunca el texto del mensaje), con el detalle en el plan (sección 6). Releer las clases después del choque
  solo puede afinar entre los dos 409 (criterio 20 e), nunca convertir el resultado en un 500.
- **Corrección del criterio 33.** Una migración nueva con los `CHECK`; la de `planes_clases` ya aplicada no se edita
  (plan, "Migraciones").

### Decisiones de la ronda 2 adversarial (17/11/2026)

- **DT-7. Qué se quita del nombre del plan y en qué orden (criterios 34 a y 34 b).** Decisión técnica del orquestador
  para cumplir DR-8, no una regla de negocio nueva. Se quitan los caracteres de formato (`Cf`) y todos los de
  `Default_Ignorable_Code_Point`, salvo los de control bidireccional (siguen con 400, como en DT-6); el braille en
  blanco U+2800 cuenta como un espacio, igual que los `Zs`; y el NFC se aplica al final, después de quitar los
  invisibles, de colapsar y de recortar, para que el nombre guardado siempre esté en NFC. Se usa la propiedad de
  Unicode y no una lista a mano, como en `textoVisibleSchema` (criterio 87 de 001). Alternativas descartadas: aplicar
  el NFC dos veces (al principio y al final; el del principio no aporta nada); NFKC (unificaría caracteres que se ven
  distintos, ver "Riesgos aceptados"); quitar solo `Cf` más una lista de excepciones (se queda corta con cada versión
  de Unicode, que es lo que encontró el ataque).

### Decisiones de diseño (técnicas)

Propuestas del especificador, aprobadas con la spec (17/11/2026).

- **D1. Días, franjas y niveles del plan en arreglos de la misma fila** (`smallint[]`, `time[]`, `nivel_natacion[]`), con
  `CHECK`. Alternativa descartada: tablas hijas por plan (más uniones, más escrituras por cambio y nada que ganar con
  menos de 20 valores).
- **D2. Horas como `time(0)` en la base y `"HH:MM"` en la API.** Alternativa descartada: un entero de 8 a 19 (no dice
  que es una hora y obliga a convertir en cada historia que compara con el reloj).
- **D3. Montos como texto en el JSON** (`"120.00"`), validados con `montoSchema` y convertidos a `Decimal` en la API.
  Alternativa descartada: números JSON, que pasan por coma flotante al leer el cuerpo (regla de `CLAUDE.md`).
- **D4. Los choques del bloque los decide la base** con índices únicos parciales (`WHERE activo`) e
  `INSERT … ON CONFLICT DO NOTHING`, y después se averigua qué índice chocó para elegir el código. Alternativa
  descartada: consultar antes de insertar (dos creaciones simultáneas pasarían las dos).
- **D5. Un bloqueo común para el cupo:** la fila de la clase (`FOR UPDATE`, ordenado por id). Alternativa descartada: un
  `pg_advisory_xact_lock` por clase (no se ve en la fila, y cada historia tendría que recordar la clave) o un contador
  de inscritos en la fila de la clase (se desincroniza con las reservas y rechazos de la 005 a la 010).
- **D6. Llave foránea compuesta hacia `usuarios`** (criterio 12 de 001): una clase no puede apuntar a un entrenador de
  otra academia, aunque la API fallara. El rol `ENTRENADOR` y el estado `ACTIVO` los comprueba la API (una llave no
  puede hacerlo).
- **D7. Nivel, día y hora inmutables en la base** (sin privilegio de `UPDATE` en esas columnas), por DR-4.
- **D8. Sin borrar:** sin política ni privilegio de `DELETE`; los planes y las clases se desactivan.
- **D9. Se audita todo cambio de planes y clases.** RN-22 nombra la caja, los pagos y los cambios de horario; un cambio
  de precio o de aforo afecta al dinero y al cupo, así que se trata igual (como D8 de 003).
- **D10. El estado del plan se calcula al leer, no se guarda,** con la fecha de Lima de `RELOJ`. Alternativa descartada:
  una columna actualizada por una tarea programada (puede quedar vieja entre ejecuciones).
- **D11. Lectura sin bloqueo del entrenador al asignarlo.** Se comprueba su rol y su estado con un `SELECT` simple; si
  lo desactivan a la vez, queda como en el criterio 25. Alternativa descartada: bloquear su fila de `usuarios` después
  de la clase (rompería el orden de bloqueos de las reglas para las historias siguientes). _(Modificada por AT-1: solo
  queda la lectura sin bloqueo al reactivar una clase con el mismo entrenador; al crear o reasignar, el entrenador se
  bloquea junto con el actor.)_

### Ajustes técnicos de la implementación (backend, commit be7170a)

Desviaciones del plan encontradas al implementar, registradas por el orquestador (17/11/2026). Ninguna cambia una regla
de negocio ni el resultado que ve el usuario en los criterios; se citan como "AT-n de 004".

- **AT-1. El entrenador se bloquea junto con el actor al crear o reasignar una clase** (modifica D11). Con la lectura
  sin bloqueo de D11 había un interbloqueo real: el mismo administrador crea o reasigna una clase con el entrenador E
  mientras desactiva a E. La desactivación de 002 bloquea las filas de `usuarios` del actor y de E con una sola
  sentencia ordenada por id (`FOR UPDATE`); la clase dejaba al actor bloqueado (`FOR SHARE`) y después la llave foránea
  pedía `FOR KEY SHARE` sobre E. Según el orden de los ids, las dos transacciones se esperaban en cruz y una terminaba
  con `40P01` y un 500. **Solución:** `POST /api/clases` y `PATCH /api/clases/{id}` con `entrenadorId` llaman a
  `bloquearActorVigente` con `objetivoId` igual al entrenador, que bloquea las dos filas en la misma sentencia
  (`ORDER BY id FOR UPDATE`, como la desactivación), siempre antes de cualquier fila de `clases`. El rol y el estado del
  entrenador se comprueban sobre esa fila bloqueada. Consecuencias: `bloquearActorVigente` sigue siendo la primera
  sentencia (criterio 7) y `bloquearClasesParaCupo` sigue justo después (criterio 22); en esas dos rutas el actor queda
  bloqueado con `FOR UPDATE` y no con `FOR SHARE`, así que dos escrituras de clases del mismo administrador con
  entrenador se ordenan entre sí. La lectura sin bloqueo de D11 solo se mantiene al reactivar una clase
  (`activo: true`) con el mismo entrenador, que no cambia `entrenador_id` y por eso no toma `FOR KEY SHARE`. La regla
  "nunca se bloquea una clase y después una fila de `usuarios`" de las reglas para las historias siguientes no cambia.
  Prueba de integración no protegida: `backend/test/integracion/planes-clases/clases-interbloqueo.test.ts`.
- **AT-2. El id de los `PATCH` lo valida el servicio, no `IdDeRuta`.** En `PATCH /api/planes/{id}` y
  `PATCH /api/clases/{id}`, el servicio comprueba que el id sea un UUID (y lo pasa a minúsculas) después de
  `bloquearActorVigente`. Así el 404 de un id que no es UUID es idéntico al de uno que no existe o es de otra academia
  (criterio 6) y llega después del 400 del cuerpo y del 401 (contrato). Alternativa descartada: `IdDeRuta`, que
  responde 400 o 404 antes de validar el cuerpo y de comprobar al actor.
- **AT-3. Dependencias.** `date-fns` `^4.4.0` y `@date-fns/tz` `^1.5.0` en `backend/package.json`, y las dos en
  `scripts/lib/dependencias-backend.mjs` (criterio 127 de 001).
- **AT-4. Campo de los errores de los arreglos.** Un error de un elemento lleva el campo con su índice
  (`diasPermitidos.2`, `franjasPermitidas.0`, `nivelesAplicables.0`); uno de la lista entera (vacía, repetidos, menos
  días que `vecesPorSemana`), el nombre de la lista (criterio 9; contrato).
- **AT-5. Segundo entrenador de la semilla (criterio 30).** Cambia lo que comprueba la prueba protegida del criterio 45
  de 002 (5 usuarios en `delfines`, 6 en total, dos entrenadores). La actualización va en un commit "Pruebas protegidas
  (004): …" del test-writer, y la parte de T10 que agrega el entrenador y las dos clases del mismo bloque con
  entrenadores distintos queda pendiente hasta ese commit ("Impacto en especificaciones anteriores").

### Ajustes menores de la revisión (ronda 3, 19/11/2026)

Registrados por el orquestador. No cambian ninguna regla de negocio ni lo que responde la API; se citan como "AT-n de
004".

- **AT-6. El afinado del 20 e deja rastro cuando falla.** `hayClaseDelMismoNivel` (la consulta posterior que elige entre
  `CLASE_DUPLICADA` y `ENTRENADOR_OCUPADO`, criterio 32 y plan, sección 9.1) registra un aviso con `errorParaRegistro`
  cuando su consulta falla, antes de devolver `false`. La respuesta no cambia (`ENTRENADOR_OCUPADO`, nunca 500).
- **AT-7. `diaSemanaSchema` se tipa como unión de literales** (`1 | 2 | … | 7`, el tipo `DiaSemana`), no como
  `number`, con los mismos mensajes y la misma validación estricta (criterio 17).
- **AT-8. La web no usa un valor por defecto silencioso en `diaDeLaSemanaEnLima`.** Si `Intl` devuelve un día que no
  reconoce, no se cae en `?? 1` (lunes) sin aviso: el caso se trata de forma explícita (criterio 28: el día que muestra
  la grilla en el celular se calcula en America/Lima).

## Preguntas abiertas

Ninguna. Las preguntas N1 a N8 y T1 a T5 quedaron decididas el 17/11/2026 (DR-1 a DR-8 y DT-1 a DT-5, en
"Decisiones", con el texto de cada pregunta y su propuesta).
