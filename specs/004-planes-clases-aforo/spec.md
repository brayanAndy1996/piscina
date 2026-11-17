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

No son críticos, pero llevan _(prueba obligatoria)_: 8, 9, 11 a 17, 19 a 21, 24 y 25 (API y dominio) y 26 a 29 (web,
con pruebas de componentes). Los 30 y 31 (semilla y documentación) los verifica el revisor.

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
   distinta de `hora_inicio` más una hora. _(crítico)_ (RN-09, RN-11, RN-25)

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
    `PLAN_CREADO` (provisional, pregunta N8). _(prueba obligatoria)_
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

    _(prueba obligatoria)_
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
  exportados para la web.
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
- **Arreglos sin repetidos solo en la API:** la base exige el rango y que no estén vacíos, pero no que no haya
  repetidos; solo el dueño de las tablas podría escribirlos.

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
  (sección "Clasificación de ruta crítica").

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

## Preguntas abiertas

Ninguna. Las preguntas N1 a N8 y T1 a T5 quedaron decididas el 17/11/2026 (DR-1 a DR-8 y DT-1 a DT-5, en
"Decisiones", con el texto de cada pregunta y su propuesta).
