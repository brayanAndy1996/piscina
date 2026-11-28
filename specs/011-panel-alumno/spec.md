# 011 · Panel del alumno y del apoderado: asistencia y nivel

- **Historias y requerimientos:** HU-06 (perfil: nombre completo, DNI, nivel, edad, plan, días y horario, clases usadas
  y restantes, fecha de vencimiento), HU-05 (cambiar la contraseña desde el perfil), HU-03 («el alumno no ve la opción de
  editar su horario»), HU-11 (estados de la mensualidad), RN-29 y supuesto 6 de 11.1 (padres y alumno usan la misma
  cuenta; con varios hijos, cada hijo tiene la suya), RN-21 y RNF-05 (datos médicos y de menores: acceso restringido),
  sección 2.1 (matriz: «Ver reportes de asistencia: Alumno, propia»; «Ver carnet digital y QR: Alumno»), 8.7 (pantallas
  del alumno), 8.8 (estados de la persona). D-08 (panel del apoderado: asistencia día por día con la hora, puntual, tarde,
  falta y totales del mes; nivel actual), D-13 (Fase 1: asistencia y nivel actual; el nivel por estilo y la evolución
  llegan con la Fase 2), D-14 (solo lectura; la única acción es cambiar la contraseña), D-23, D-28, D-29, D-31.
- **Decisiones que esta historia aplica:** «Reglas para las historias siguientes» de la
  [spec 010](../010-mensualidades/spec.md) («Panel del alumno (011): muestra el estado de la mensualidad con
  `estadoDeMensualidad`, en solo lectura»); DR-1 de 010 (la renovación la registra recepción; no se renueva desde el
  panel); DT-13 de la [spec 009](../009-asistencia/spec.md) (la consulta del mes de recepción es solo `TODO`; la 011 suma
  el alcance `PROPIO`); criterios 6 y 20 de la [spec 008](../008-carnet-qr/spec.md) (`/api/mi-carnet` y
  `/panel/mi-carnet`).
- **Ruta crítica:** sí. Permisos y datos sensibles (el panel muestra solo a ese alumno, en solo lectura, con datos de
  menores, Ley 29733) y aislamiento entre academias y entre alumnos. Los cálculos que se muestran (estado de la
  mensualidad, edad) y las pantallas llevan prueba obligatoria, sin ser críticos.
- **Estado:** aprobada por Bryan el 28/11/2026, con la propuesta de las cinco preguntas (P1 a P5, que son DR-1 a DR-5
  de esta spec, en «Resueltas»); el orquestador aceptó DT-1 a DT-16 del plan el mismo día. **En pruebas protegidas.**
- **Entregas:** una sola (D-31: la spec cabe holgada en el tope de 800 líneas y tiene una sola superficie de ataque).

## Objetivo

Que el alumno, y su padre, madre o apoderado con la misma cuenta (RN-29), vean en el celular cómo va: sus datos, su
plan y horario, cuántas clases le quedan, hasta cuándo está pagado y el estado de su mensualidad, su nivel actual y su
asistencia día por día (puntual, tarde o falta, con la hora de llegada) con los totales del mes. Todo en solo lectura:
para cambiar algo se acerca a recepción. La única acción es cambiar la contraseña (D-14).

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Quién es «mi alumno» (1 y 2):** el alumno sale solo de la sesión, nunca de un id que mande quien pide; la base impide
  que una cuenta quede unida a dos alumnos.
- **Permisos (3):** solo la cuenta `ALUMNO` entra; el personal y el entrenador no ven el panel de nadie por estas rutas
  (sección 2.1, D-29).
- **Aislamiento entre alumnos y entre academias (4 y 5):** un hermano no ve al otro; la misma persona en dos academias
  (D-28) no mezcla datos (D-23, RLS).
- **Datos sensibles (6 y 12):** el panel no lleva datos médicos, del apoderado, de pagos, tokens ni ids (Ley 29733,
  RNF-05, RN-06).
- **Solo lectura (14 y 15):** el panel no escribe, y la cuenta del alumno no puede escribir nada fuera de su contraseña y
  su cierre de sesión (D-14).

Llevan _(prueba obligatoria)_, sin ser críticos: 7 a 11, 13, 16 y 17 (API y contratos), 18 y 19 (web, con pruebas de
componentes) y 20 (E2E). El 21 (documentación) lo verifica el revisor.

## Definiciones

Se reutilizan, sin copiarlas, las definiciones de la [spec 010](../010-mensualidades/spec.md#definiciones): **«ahora» y
hoy** (`RELOJ.ahora()` y su fecha en America/Lima), **mes en curso (M)**, **mes siguiente (M+1)** y **mes anterior
(M−1)**. Además:

- **Alumno de la sesión:** la única fila de `alumnos` con `academia_id` igual a la academia de la sesión, `usuario_id`
  igual al id del usuario de la sesión y `estado` distinto de `CLIENTE`. Si no hay ninguna, las rutas del panel
  responden 404 `NO_ENCONTRADO` (el mismo cuerpo que la 008). Nunca se toma de la dirección, de la consulta, del cuerpo
  ni de una cabecera.
- **Mensualidad pagada del mes X:** una matrícula del alumno de ese mes en `VIGENTE` o `FINALIZADA`. **En
  verificación:** una matrícula `RESERVADA` sin `reserva_vence_en` con un pago `PENDIENTE_VERIFICACION` (RN-28). Son las
  mismas que usa el listado de mensualidades (criterio 25 de 010); si hay una pagada y otra en verificación del mismo mes,
  manda la pagada.
- **Estado de la mensualidad:** `estadoDeMensualidad` (criterio 24 de 010) para X = M, con `diasPorVencer` leído con
  `leerConfiguracion(tx)` en la misma transacción, sin caché.
- **Mensualidad mostrada (`actual`):** según el estado: con `AL_DIA` o `POR_VENCER`, la pagada de M; con
  `PENDIENTE_VERIFICACION`, la de M (la pagada si la hay; si no, la que está en verificación); con `VENCIDO`, la pagada
  de M−1; sin estado (`null`), ninguna. Es la misma que elige el listado para su fila (criterio 25 de 010).
- **Mensualidad siguiente (`siguiente`):** la de M+1, pagada o en verificación (manda la pagada), si existe.
- **Nivel actual:** `alumnos.nivel` (Básico, Intermedio o Avanzado; D-08, sección 9.1). El nivel por estilo y la
  evolución mes a mes son de la 013 (D-13, D-15).

## Criterios de aceptación

### A. Quién es «mi alumno»

1. **Una cuenta, un alumno.** La migración `<marca>_panel_alumno` crea el índice único
   `alumnos_academia_id_usuario_id_key` sobre `alumnos (academia_id, usuario_id)` (y `@@unique([academiaId, usuarioId])`
   en `schema.prisma`). No cambia privilegios ni políticas. Prueba como app y como dueño de las tablas: unir un segundo
   alumno de la misma academia al `usuario_id` de otro responde `23505`; varios alumnos con `usuario_id` nulo (clientes)
   se aceptan. _(crítico)_ (RN-29, D-28)
2. **El alumno sale de la sesión.** `GET /api/mi-panel` y `GET /api/mi-panel/asistencias` no reciben ningún id. Con la
   sesión del alumno A1, la respuesta es idéntica (mismo estado y mismo cuerpo) con y sin cualquiera de estos agregados
   que apuntan a otro alumno, a otro usuario o a otra academia: `?id=`, `?alumnoId=`, `?usuarioId=`, `?academiaId=`,
   `?nombreCorto=`, un cuerpo JSON con esos campos, y las cabeceras `X-Alumno-Id`, `X-Usuario-Id` y `X-Academia-Id`.
   Una cuenta `ALUMNO` sin alumno de la sesión (por ejemplo, con su fila de `alumnos` puesta a mano, como dueño, en
   `CLIENTE` o sin `usuario_id`) recibe 404 `NO_ENCONTRADO`. Si la consulta del alumno de la sesión devolviera más de una fila, la petición falla con 500
   `ERROR_INTERNO` sin datos (falla cerrada; con el criterio 1 no puede pasar). _(crítico)_ (D-14, D-23)

### B. Permisos y aislamiento

3. **Solo la cuenta del alumno.** `GET /api/mi-panel` lleva `@Permiso('VER_CARNET')` y `GET /api/mi-panel/asistencias`,
   `@Permiso('VER_REPORTES_ASISTENCIA')`; las dos exigen el alcance `PROPIO` antes de leer nada (DT-2 del plan). `ADMIN` y
   `SECRETARIA` reciben 403 `SIN_PERMISO` (su alcance es `TODO`; ven al alumno por sus propias rutas); `ENTRENADOR`, 403
   `SIN_PERMISO`. Sin sesión, o con solo la sesión del Superadmin, 401 `NO_AUTENTICADO` (D-29). Con el cambio de
   contraseña pendiente (primer ingreso o clave restablecida), 403 `CAMBIO_DE_CLAVE_OBLIGATORIO` (RN-02, RNF-04). Una
   sesión que dejó de valer porque recepción restableció la clave (sube `version_token`, 002) responde 401. Con la academia
   suspendida, lo mismo que `GET /api/mi-carnet`. Orden: sesión → academia → cambio obligatorio → permiso → alcance →
   `mes` (criterio 12) → alumno de la sesión. _(crítico)_ (sección 2.1, D-14, D-29)
4. **Un hermano no ve al otro.** En la academia A, los hermanos H1 y H2 (menores, con el mismo apoderado: mismo DNI,
   nombre y teléfono) tienen cada uno su cuenta (supuesto 6 de 11.1), su matrícula en clases distintas, asistencias y
   faltas. Con la sesión de H1:
   - el resumen y la asistencia de cada mes traen solo datos de H1: ningún nombre, DNI, plan, clase, fecha, hora ni
     conteo de H2 aparece en el cuerpo;
   - los agregados del criterio 2 con el id del alumno o del usuario de H2 no cambian nada;
   - las rutas del personal con el id de H2 siguen respondiendo 403 `SIN_PERMISO`, como hasta ahora:
     `GET /api/alumnos/{H2}/asistencias`, `/carnet`, `/carnet/pdf`, `/horario`, `/renovacion` y
     `GET /api/mensualidades?alumnoId={H2}`.

   _(crítico)_ (RN-29, Ley 29733, D-14)
5. **La misma persona en dos academias.** La persona P (mismo DNI) es alumna de A y de B (D-28), con cuentas, planes,
   clases, asistencias y faltas distintas, y nombres de academia distintos. Con la sesión de P en A, ninguna de las dos
   rutas trae nada de B; con la de B, nada de A. Con la transacción de A, la consulta del alumno de la sesión con el
   `usuario_id` de la cuenta de B no devuelve filas (RLS) y la ruta responde 404. Suspender B no cambia las respuestas de
   A. _(crítico)_ (D-23, D-28)

### C. Resumen del panel

6. **Lo que lleva y lo que no lleva el resumen.** `GET /api/mi-panel` responde 200 con `miPanelSchema` (estricto,
   «Contrato»): `hoy`, `mesEnCurso`, `alumno` (`nombres`, `apellidos`, `dni`, `nivel`, `edad`, `estado`), `mensualidad`
   (`estado`, `actual`, `siguiente`) y `mesesDeAsistencia`. No lleva ningún id (ni del alumno, ni del usuario, ni de
   matrículas, planes, clases o pagos), ni fecha de nacimiento, teléfono, correo, dirección, colegio, ficha médica,
   contacto de emergencia, apoderado, consentimientos, foto ni `foto_clave`, token o contenido del QR, código o token de
   seguimiento, montos, método de pago, número de operación, comprobante, motivo de rechazo, ajuste de monto ni su
   motivo, entrenador de la clase, ni quién registró una asistencia o su motivo (DR-1). Prueba: las claves
   exactas del JSON para un adulto y para un menor con apoderado, ficha médica (alergias y enfermedades), consentimientos,
   foto, QR, un pago por Yape con número de operación, un ajuste de monto con motivo y un registro posterior con motivo,
   todos con textos únicos; ninguno de esos textos aparece en el cuerpo de las dos rutas del panel. _(crítico)_ (HU-06,
   RN-21, RNF-05, RN-06, Ley 29733)
7. **Datos del alumno.** `nombres`, `apellidos` y `dni` del alumno; `nivel` es el nivel actual (definición); `estado` es
   `alumnos.estado` (`ALUMNO_ACTIVO`, `ALUMNO_VENCIDO` o `INACTIVO`); `edad` es `edadEnFecha(fecha_nacimiento, hoy)`
   (criterio 17), con hoy en Lima. Prueba con `RELOJ` y el proceso en `TZ=Asia/Tokyo`: quien cumple 12 años el 1/12/2026
   tiene 11 el 30/11 a las 23:59:59.999 de Lima (ya es 1/12 en UTC) y 12 el 1/12 a las 00:00:00.000. _(prueba
   obligatoria)_ (HU-06, RNF-12)
8. **Mensualidad.** `mensualidad.estado` es el estado de la mensualidad (definición) o `null` si `estadoDeMensualidad`
   no da estado. `actual` es la mensualidad mostrada (definición) o `null`; `siguiente`, la mensualidad siguiente o
   `null`. Cada una lleva `mes` (`AAAA-MM`), `plan` (`{ nombre }`, el nombre actual del plan), `clases` (día de la
   semana, hora de inicio y de fin de cada clase de la matrícula, también si la clase está inactiva, ordenadas por día y
   hora; después de un cambio de horario, las clases de ahora, 010c), `clasesUsadas`, `clasesTotales`,
   `clasesRestantes` (`clasesTotales − clasesUsadas`), `desde` y `hasta` (`fecha_inicio` y `fecha_fin`, `AAAA-MM-DD`;
   `hasta` es la fecha de vencimiento que muestra la web, DR-3). `siguiente` lleva además `estado`
   (`PAGADA` o `EN_VERIFICACION`). Un alumno `INACTIVO` recibe `estado: null`, `actual: null` y `siguiente: null`
   (DR-4). _(prueba obligatoria)_ (HU-06, HU-11)
9. **Ejemplos de la mensualidad en Lima.** Con `RELOJ` fijo, `diasPorVencer` = 5 y el proceso en `TZ=Asia/Tokyo`, un
   alumno con noviembre de 2026 pagado (12 clases, 5 usadas):
   - el 25/11 a las 23:59:59.999 de Lima: `AL_DIA`, `actual` noviembre, 7 restantes, `hasta` `2026-11-30`;
   - el 26/11 a las 00:00:00.000: `POR_VENCER`; con diciembre pagado, `AL_DIA` y `siguiente` diciembre `PAGADA`; con
     diciembre en verificación, `PENDIENTE_VERIFICACION` y `siguiente` diciembre `EN_VERIFICACION`;
   - el 30/11 a las 19:00 (ya es 1/12 en UTC): sigue siendo noviembre (`mesEnCurso` `2026-11`);
   - el 1/12 a las 00:00:00.000 sin diciembre: `VENCIDO` con `actual` noviembre, aunque la tarea del cierre de mes no
     haya corrido (el alumno sigue `ALUMNO_ACTIVO` en la base); con diciembre pagado: `AL_DIA` con `actual` diciembre;
   - un alumno nuevo que se inscribió para diciembre (010d), el 28/11: `estado: null`, `actual: null` y `siguiente`
     diciembre `PAGADA`;
   - un alumno con su última mensualidad pagada en septiembre, el 15/11: `estado: null`, `actual: null`,
     `siguiente: null`.

   _(prueba obligatoria)_ (HU-11, RNF-12, D-06)
10. **El mismo estado que ve recepción.** Para un mismo alumno y un mismo instante (`RELOJ` fijo), en cada escenario del
    criterio 9: si `GET /api/mensualidades?alumnoId={id}` (010b, sesión de la secretaria) trae la fila del alumno, su
    `estado`, su `mensualidad` (mes, nombre del plan, días y horas de las clases, usadas y totales) y su `siguiente` (mes
    y estado) coinciden con `estado`, `actual` y `siguiente` del panel; si no la trae, el panel da `estado: null`.
    _(prueba obligatoria)_ (regla de 010)
11. **Meses de asistencia.** `mesesDeAsistencia` trae M siempre y, además, cada mes anterior a M en el que el alumno tuvo
    una mensualidad pagada, del más nuevo al más viejo y sin repetir (DR-2). Nunca trae M+1 ni un mes
    posterior, aunque ya esté pagado. _(prueba obligatoria)_ (D-08)

### D. Asistencia

12. **Asistencia del mes.** `GET /api/mi-panel/asistencias?mes=AAAA-MM` (sin `mes`, el mes en curso de Lima) responde 200
    con `asistenciaDelMesSchema` (criterio 31 de 009, sin cambios): `mes`, `matricula` (clases totales, usadas y
    restantes de la matrícula `VIGENTE` o `FINALIZADA` de ese mes, o `null`) y `registros` por fecha (cada asistencia con
    su clase, `horaLlegada`, `estadoLlegada`, `metodo`, `registroPosterior` y `faltaCubierta`; cada falta sin cubrir con
    su clase). El cuerpo es igual, byte a byte, al de `GET /api/alumnos/{id}/asistencias?mes=` del mismo alumno, el
    mismo mes y el mismo instante pedido por el administrador. Sin DNI, motivo ni quién registró. Un `mes` con otra forma,
    repetido, anterior a 2000-01 o posterior a M responde 400 `SOLICITUD_INVALIDA` con el campo `mes`; un mes sin datos,
    200 con `matricula: null` y `registros: []`. _(crítico)_ (D-08, sección 2.1 «propia», Ley 29733)
13. **Bordes de la asistencia en Lima.** Con `RELOJ` fijo y `TZ=Asia/Tokyo`: la asistencia de la clase de 19:00 a 20:00
    del 30/11/2026 marcada a las 19:05 sale en `2026-11` (puntual) y la consulta sin `mes` a las 19:30 de ese día es la de
    `2026-11`; la falta de esa clase que registra la tarea (009b) sale también en `2026-11`; el 1/12 a las 00:00:00.000 la
    consulta sin `mes` es la de `2026-12`. _(prueba obligatoria)_ (RNF-12, D-11, D-16)

### E. Solo lectura

14. **El panel no escribe.** Después de llamar 20 veces a cada ruta del panel (con y sin `mes`), ninguna fila de
    `usuarios`, `alumnos`, `apoderados`, `fichas_medicas`, `matriculas`, `matricula_clases`, `pagos`, `asistencias`,
    `inasistencias`, `movimientos_caja` ni `auditoria` cambia (comparación del contenido de cada tabla, como dueño) y no se
    registra auditoría. Las dos lecturas corren en una sola transacción de la academia cada una, sin `FOR UPDATE`,
    `FOR SHARE` ni bloqueos consultivos. `POST`, `PUT`, `PATCH` y `DELETE` sobre `/api/mi-panel` y
    `/api/mi-panel/asistencias`, con la sesión del alumno, responden 404 como una ruta inexistente. _(crítico)_ (D-14)
15. **La cuenta del alumno solo cambia su contraseña.** Una prueba recorre todos los manejadores de la aplicación real
    con un método distinto de `GET`, fuera de `/api/a/…`, `/api/plataforma/…` y `/api/salud`, y sin `DELETE /api/sesion`
    (cerrar sesión, que no lleva decorador ni pasa por el middleware de sesión, criterio 54 de 002):
    - los únicos que el guard de permisos deja pasar al rol `ALUMNO` (por `@SoloSesion()` o por un `@Permiso` cuya fila
      de la matriz tiene celda para `ALUMNO`) son `POST /api/sesion/clave` y `POST /api/alumnos/buscar` (de
      `VER_CARNET`, que el alcance rechaza con 403, criterio 16 de 008);
    - cada uno de los demás, y `POST /api/alumnos/buscar`, pedido con la sesión de un alumno (cambio de clave hecho), sin
      cuerpo o con `{}` y con los parámetros de la dirección llenos con ids que existen en su academia (su propio alumno,
      su matrícula, su pago, una clase, la caja), responde 4xx (nunca 2xx) y no cambia ninguna fila (la comparación del
      criterio 14).

    Si una historia futura agrega una escritura que deja pasar al alumno, esta prueba falla hasta que su spec la agregue a
    la lista con una decisión del responsable. _(crítico)_ (D-14, HU-03, sección 2.1)

### F. Detalles de la API y contratos

16. **Cabeceras, `HEAD` y registro técnico.** Las respuestas 200 de las dos rutas llevan `Cache-Control: no-store` (DT-8
    del plan). `HEAD` sobre `/api/mi-panel` y lo que cuelga de él responde 404 sin leer la base (`/mi-panel` se suma a
    `PREFIJOS_SIN_HEAD`). Con el registro técnico en `debug`, ninguna línea de estas peticiones lleva el DNI, los nombres,
    la edad ni el cuerpo de la respuesta. _(prueba obligatoria)_ (Ley 29733, criterio 43 de 002)
17. **Contratos compartidos.** En `packages/contratos/`: `miPanelSchema`, `mensualidadDelPanelSchema` y
    `siguienteDelPanelSchema` (estrictos; rechazan una clave de más, por ejemplo `id`, `dni` dentro de `actual` o
    `apoderado`); y `edadEnFecha(fechaNacimiento, hoy)` junto a `esMenorDeEdad`, con textos `AAAA-MM-DD` y la misma regla:
    cumple años el día de su cumpleaños, y quien nació el 29 de febrero cumple el 1 de marzo en los años no bisiestos.
    Pruebas unitarias: el día antes, el mismo día y el día después del cumpleaños; el 29/2 en años bisiestos y no
    bisiestos; `esMenorDeEdad(f, h) === (edadEnFecha(f, h) < 18)` para 1 000 pares al azar. _(prueba obligatoria)_

### G. Web

18. **El panel del alumno.** En `/panel`, la cuenta `ALUMNO` (alcance `PROPIO` de `VER_CARNET`) ve, sobre las opciones
    del inicio:
    - **Mis datos:** nombre completo, DNI, edad («11 años»), nivel («Nivel: Básico»);
    - **Mi mensualidad:** el estado con su color (los de `/panel/mensualidades`), el plan, los días y horas, «Clases: 5 de
      12 usadas · te quedan 7» y «Vence el 30/11/2026» (de `actual`); con `siguiente`, «Diciembre: pagada» o «Diciembre:
      pago en verificación»; con `POR_VENCER` o `VENCIDO`, «Para renovar, acércate a recepción»; con `estado: null` y
      `siguiente`, «Tu mensualidad empieza el 01/12/2026»; sin ninguna, «No tienes una mensualidad vigente. Acércate a
      recepción»; con `INACTIVO`, «Tu cuenta está inactiva en la academia. Acércate a recepción»;
    - **Mi asistencia:** un selector de mes con `mesesDeAsistencia` (por defecto `mesEnCurso`), los totales del mes
      (puntual, tarde, faltas y clases restantes), y cada día con su fecha, la hora de la clase, «Puntual», «Tarde» o
      «Falta» y la hora de llegada.

    El mes en curso, el «hoy» y los meses salen de la API, nunca del reloj del navegador (DT-7 del plan). Las claves de
    TanStack Query llevan la identidad de la sesión. El personal y el entrenador no ven estas secciones. Un 404 muestra
    «No encontramos tu ficha de alumno. Acércate a recepción.»; un 401 lleva al ingreso (`useAlPerderSesion`); otro error
    ofrece «Volver a intentar». _(prueba obligatoria, componentes)_ (HU-06, D-08)
19. **Solo lectura en la web.** El panel del alumno no tiene campos de texto, ni botones o enlaces para editar datos,
    cambiar el horario, subir foto, renovar, pagar o regenerar el QR. Sus únicas acciones son el selector de mes,
    «Mi carnet» (`/panel/mi-carnet`, 008), «Cambiar contraseña» (`/cambiar-clave`, 002) y «Cerrar sesión». Muestra el
    texto «Para corregir tus datos o cambiar tu horario, acércate a recepción.» (D-14, HU-03). _(prueba obligatoria,
    componentes)_
20. **Flujo completo.** Una prueba E2E con Playwright: el alumno ingresa en `/a/{academia}/ingresar` con su DNI como
    usuario y clave, cambia la contraseña obligatoria, ve en `/panel` su nombre, su mensualidad y una asistencia del mes
    con su hora; no ve el nombre de su hermano, que tiene su propia cuenta; cierra sesión y vuelve al ingreso. _(prueba
    obligatoria, E2E)_ (HU-05, HU-06, RN-29)
21. **Documentación.** `docs/arquitectura.md` («Lo que construye la historia 011»: las rutas, el alumno de la sesión, el
    índice único, los permisos reutilizados y la prueba del inventario de escrituras del criterio 15), la guía de Windows
    («Ver el panel del alumno»: cobrar una solicitud de la semilla, entrar con el DNI y marcar una asistencia) y la nota
    de la 011 en `specs/backlog.md`. _(revisor)_

## Casos límite

- **Alumno vencido:** entra, ve su panel con `VENCIDO`, su última mensualidad y su historial, como ya ve su carnet
  (criterio 6 de 008). La renovación la hace recepción (DR-1 de 010).
- **Vencido desde hace más de un mes:** `estado: null` (como en el listado, DR-8 de 010) y la web dice «No tienes una
  mensualidad vigente». Su historial de meses anteriores sigue visible.
- **Inscrito para el mes siguiente (010d):** antes del día 1 no tiene mensualidad de M; la web dice cuándo empieza.
- **El 1 del mes antes de la tarea del cierre:** el panel ya dice `VENCIDO` (sale de `estadoDeMensualidad`, no de
  `alumnos.estado`), aunque `alumno.estado` todavía sea `ALUMNO_ACTIVO`. La web muestra el estado de la mensualidad, no
  el de la persona, salvo `INACTIVO`.
- **Cambio de horario a mitad de mes (010c):** el horario del resumen es el de ahora; cada registro de asistencia muestra
  la clase de ese día.
- **Clase desactivada:** sigue apareciendo en el horario de su matrícula, como en el carnet.
- **Asistencia anterior a la 009:** no existe; esos meses salen vacíos.
- **Registro posterior (009b):** aparece como una asistencia más, con su hora; la falta que cubrió no aparece.
- **Cambio de contraseña de un adolescente:** puede dejar fuera a sus padres; recepción la restablece al DNI (HU-05,
  riesgo «Cuenta compartida» de 11.4).
- **Hermanos en la misma academia:** una cuenta por hijo (supuesto 6); el apoderado cierra sesión y entra con la otra.
- **Cuenta del alumno con la academia suspendida:** las respuestas de acceso de la 002, como cualquier ruta de academia.

## Reglas de negocio aplicables

- RN-29 y supuesto 6: misma cuenta para alumno y apoderado; una cuenta por hijo.
- D-14: solo lectura; la única acción es cambiar la contraseña.
- D-08 y D-13: asistencia día por día con la hora (puntual, tarde, falta), totales del mes y nivel actual en la Fase 1.
- HU-06: los datos del perfil.
- RN-21 y RNF-05: los datos médicos y de menores tienen acceso restringido (DR-1).
- HU-11 y la regla de 010: el estado de la mensualidad sale de `estadoDeMensualidad`.
- D-23 y D-28: cada academia aparte, aunque la persona sea la misma.

## Contrato

- **Endpoints:**
  - `GET /api/mi-panel` → 200 `miPanelSchema`:
    `{ hoy: 'AAAA-MM-DD', mesEnCurso: 'AAAA-MM', alumno: { nombres, apellidos, dni, nivel, edad, estado },
    mensualidad: { estado: EstadoMensualidad | null, actual: MensualidadDelPanel | null,
    siguiente: (MensualidadDelPanel & { estado: 'PAGADA' | 'EN_VERIFICACION' }) | null },
    mesesDeAsistencia: 'AAAA-MM'[] }`, con
    `MensualidadDelPanel = { mes, plan: { nombre }, clases: { diaSemana, horaInicio, horaFin }[], clasesUsadas,
    clasesTotales, clasesRestantes, desde, hasta }`. Errores: 401, 403 (`SIN_PERMISO`, `CAMBIO_DE_CLAVE_OBLIGATORIO`),
    404 `NO_ENCONTRADO`.
  - `GET /api/mi-panel/asistencias?mes=AAAA-MM` → 200 `asistenciaDelMesSchema` (009b). Errores: los anteriores y 400
    `SOLICITUD_INVALIDA` (campo `mes`).
  - Sin cambios: `POST /api/sesion/clave` (002), `GET /api/mi-carnet` y `/pdf` (008).
- **Eventos:** ninguno. Sin correos.
- **Permisos:** `VER_CARNET` y `VER_REPORTES_ASISTENCIA` con alcance `PROPIO` (solo `ALUMNO`; DT-2). Sin cambios en
  `MATRIZ_PERMISOS`.

## Cambios al modelo de datos

- Índice único `alumnos_academia_id_usuario_id_key` sobre `alumnos (academia_id, usuario_id)` (criterio 1). Sin tablas ni
  columnas nuevas; sin cambios de privilegios ni de políticas de RLS.

## Fuera de alcance

- Nivel por estilo, evolución mes a mes y evaluaciones del entrenador (013, D-12, D-13, D-15).
- Fotos y videos (014), certificados (Fase 4), clases recuperables y recuperaciones en el perfil y el horario (017 y
  018; HU-35, HU-41), clases particulares (016), asistencia autorizada en otro horario (020): cuando lleguen, cada una
  suma lo suyo al panel.
- Renovar o pagar desde el panel (DR-1 de 010, D-14) y editar cualquier dato (D-14).
- Avisos de pago verificado o rechazado y de vencimiento dentro del panel (HU-33, prioridad C; DR-5).
- Historial de pagos del alumno (ninguna HU lo pide).
- Cuentas separadas para apoderados o un selector de hijos (RN-29, supuesto 6).
- Exportar la asistencia (reportes, Fase 3) y la PWA (Fase 4).
- Un límite de peticiones propio de estas rutas: es el pendiente general de la 006 (DT-14 de 006, nota de la 002 en el
  backlog).

## Impacto en especificaciones anteriores

- **009 (DT-13, criterio 31):** el alcance `PROPIO` de la consulta del mes llega por una ruta nueva sin id. La ruta del
  personal `GET /api/alumnos/{id}/asistencias` no cambia: el `ALUMNO` sigue recibiendo 403, y sus pruebas protegidas no se
  tocan. `ConsultaDeAsistenciaService` se reorganiza para servir a las dos rutas, sin cambiar su respuesta.
- **010 (criterios 24 y 25):** el panel usa `estadoDeMensualidad` y la misma lectura de mensualidades que el listado
  (DT-4 del plan). El listado no cambia su respuesta; sus pruebas protegidas no se tocan.
- **008 (criterio 20):** el inicio del alumno sigue mostrando «Mi carnet» y suma las secciones del panel.
- **007 («Fuera de alcance»):** «después de entrar, el alumno ve el inicio genérico de la 002» deja de valer: ve su
  panel.
- **005 (modelo):** `alumnos` suma el índice único del criterio 1. El test-writer comprueba antes que ninguna prueba
  protegida fije la lista exacta de índices de `alumnos`; si alguna la fija, se para y se avisa al orquestador.

## Riesgos aceptados

- **Cuenta compartida (RN-29, 11.4):** el alumno y sus padres comparten la contraseña; si uno la cambia, el otro queda
  fuera hasta que recepción la restablezca. Lo decidió el negocio.
- **Dispositivo compartido:** los datos de un menor quedan en pantalla mientras la sesión esté abierta. Lo mitigan
  `Cache-Control: no-store`, que cerrar sesión limpia la caché de la web (002) y la duración de la sesión de la 002.
- **Dos lecturas separadas:** el resumen y la asistencia son dos peticiones; una asistencia marcada entre las dos puede
  mostrar por un momento clases restantes distintas en cada sección. Se corrige al refrescar.
- **Sin límite de peticiones propio:** como el resto de la API con sesión (DT-14 de 006).
- **`INACTIVO` sin dueño:** ninguna historia pone todavía a un alumno en `INACTIVO`; el panel aplica DR-4. Si la historia
  que traiga ese estado necesita otra cosa (por ejemplo, impedir el ingreso), lo decide su especificación con Bryan.

## Decisiones

- Las decisiones técnicas (DT-1 a DT-16) están en «Decisiones» de [`plan.md`](plan.md), cada una con su alternativa;
  el orquestador las aceptó el 28/11/2026. Las decisiones del responsable (DR-1 a DR-5) están en «Resueltas».
- Resuelto por los documentos, sin pregunta: el apoderado entra con la cuenta del alumno (RN-29, D-14); con varios hijos,
  una cuenta por hijo (supuesto 6 de 11.1); el nivel actual es `alumnos.nivel` (D-08, 9.1); el alumno vencido ve su
  panel (como su carnet, criterio 6 de 008) y renueva en recepción (DR-1 de 010); el carnet y el QR siguen en
  `/panel/mi-carnet` (criterio 20 de 008; DT-11).

## Preguntas abiertas

Las cinco preguntas de negocio (P1 a P5) quedaron resueltas: ver «Resueltas». No queda ninguna pregunta abierta.

## Resueltas

Decisiones del responsable. Bryan aprobó la propuesta de cada pregunta el 28/11/2026.

- **DR-1 (pregunta P1). Qué datos personales ve la familia.** HU-06 pide nombre, DNI, nivel, edad, plan, horario,
  clases y vencimiento; RN-21 deja los datos médicos a la secretaria, el administrador y el entrenador, y RNF-05 pide
  acceso restringido para los datos de salud y de menores. **Decidido por Bryan el 28/11/2026 (la propuesta):** solo lo
  de HU-06; ni ficha médica, ni datos del apoderado, ni teléfono, correo, dirección o fecha de nacimiento (la edad sí).
  Para revisar o corregir esos datos, recepción. Alternativa descartada: mostrar también la ficha médica y los datos del
  apoderado, en solo lectura, para que la familia los revise. _(Criterios 6, 7 y 18; DT-14.)_
- **DR-2 (pregunta P2). Desde cuándo se ve la asistencia.** **Decidido por Bryan el 28/11/2026 (la propuesta):** el mes
  en curso y todos los meses anteriores en los que tuvo mensualidad en la academia, con un selector (por defecto, el mes
  en curso). Alternativa descartada: solo el mes en curso y el anterior, como la ficha de recepción. _(Criterios 11, 12 y
  18.)_
- **DR-3 (pregunta P3). Qué fecha es «vence el».** **Decidido por Bryan el 28/11/2026 (la propuesta):** el último día de
  la mensualidad que se muestra (`actual.hasta`, por ejemplo «Vence el 30/11»), y aparte el estado del mes siguiente
  («Diciembre: pagada» o «Diciembre: pago en verificación») si ya renovó. Alternativa descartada: el último día de la
  última mensualidad pagada («Vence el 31/12» si ya pagó diciembre). _(Criterios 8 y 18.)_
- **DR-4 (pregunta P4). Qué ve un alumno inactivo.** Hoy ninguna historia pone a un alumno en `INACTIVO`, pero el estado
  existe (8.8). **Decidido por Bryan el 28/11/2026 (la propuesta):** entra y ve sus datos y su historial de asistencia,
  con el aviso «Tu cuenta está inactiva en la academia. Acércate a recepción», sin estado de mensualidad (`estado`,
  `actual` y `siguiente` en `null`). Alternativa descartada: no puede entrar mientras esté inactivo. _(Criterios 8 y 18;
  «Riesgos aceptados».)_
- **DR-5 (pregunta P5). Aviso del pago de renovación rechazado.** HU-33 (prioridad C) pide avisos de pago verificado o
  rechazado, y D-08 dice que, si se hacen, van dentro del panel. **Decidido por Bryan el 28/11/2026 (la propuesta):** no
  en la 011; el alumno ya recibe el correo del rechazo (DR-7 de 010) y el panel muestra «en verificación» mientras se
  revisa. Queda para cuando se haga la HU-33. Alternativa descartada: mostrar en el panel el último pago rechazado con su
  motivo, hasta que pague otro. _(«Fuera de alcance».)_
