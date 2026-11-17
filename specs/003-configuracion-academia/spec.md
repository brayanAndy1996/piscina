# 003 · Configuración de la academia

- **Historias y requerimientos:** D-07 (tabla de configuración clave/valor con la tolerancia de tardanza, los días "por
  vencer", los días de prioridad para renovar, el máximo de intentos de inicio de sesión y el tiempo de bloqueo), D-11
  (tolerancia de 10 minutos que el administrador puede cambiar), HU-11 ("por vencer": últimos 5 días, configurable),
  D-06 (prioridad al renovar durante los últimos N días, por defecto 5), D-22 (nombre, teléfono y logo de la academia
  leídos de la configuración), D-23 (toda la configuración es por academia), D-29 (el Superadmin no ve datos internos),
  HU-05, RNF-03 y sección 11.4 (bloqueo tras varios intentos fallidos; DR-3 de 002), RN-22 y RNF-06 (auditoría),
  RNF-12 (español, America/Lima). Cumple DR-8 de 001 (la 003 define las claves y sus valores por defecto).
- **Ruta crítica:** en parte. El bloqueo por intentos fallidos (autenticación), el aislamiento de la configuración
  entre academias y quién puede cambiarla (permisos) son de la lista de `CLAUDE.md`; guardar y mostrar los demás
  valores, la web, la semilla y la documentación no lo son. _(Aprobado por el orquestador, DT-2; el backlog la marca
  "En parte".)_
- **Estado:** aprobada por el responsable (17/11/2026), con las propuestas de todas las preguntas de negocio (DR-1 a
  DR-7 de esta spec) y las técnicas aprobadas por el orquestador (DT-1 a DT-3), en "Decisiones". Ningún criterio
  cambió. No quedan preguntas abiertas. Los criterios 4, 5 y 13 llevan una "precisión del orquestador (17/11/2026)"
  que explicita lo que ya exigían las pruebas protegidas, sin cambiar su intención.

## Objetivo

Que el administrador de cada academia ajuste, sin tocar el código, los valores que las reglas del negocio dejan
configurables: la tolerancia de tardanza (D-11), los días "por vencer" (HU-11), los días de prioridad al renovar (D-06)
y el bloqueo por intentos fallidos (D-07), además del teléfono de la academia (D-22). Cada academia tiene los suyos y
nunca ve ni toca los de otra (D-23). Las historias siguientes (009 asistencia, 010 mensualidades) leen estos valores
con una función común; esta historia ya los aplica al bloqueo del inicio de sesión, que en la 002 era fijo (5 intentos,
15 minutos).

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Aislamiento y permisos (4, 5 y 11):** la configuración es un dato interno de cada academia; si el administrador de
  A pudiera leer o cambiar la de B, o una secretaria pudiera bajar el bloqueo, se rompe el aislamiento (D-23) o la
  matriz de permisos. El 11 aplica a esta escritura la regla DT-5 de 002 (`bloquearActorVigente`): un administrador
  desactivado con una petición en curso no debe poder cambiar la seguridad de la academia.
- **Bloqueo configurable (13 a 17):** autenticación. Un error al leer o aplicar los valores (los de otra academia, un
  valor guardado inválido que deje la cuenta sin bloqueo, un plazo mal calculado) quita la protección de la contraseña
  inicial igual al DNI (RN-02, sección 11.4). El 17 cuida que leer la configuración no vuelva a delatar, por el trabajo
  en la base, si un DNI tiene cuenta (criterio 53 de 002).

No son críticos, pero llevan _(prueba obligatoria)_: 1 a 3, 6 a 10, 12, 18 a 21 (API, dominio y registro técnico) y 22 a
24 (web, con pruebas de componentes). Los 25 y 26 (semilla y documentación) los verifica el revisor.

## Criterios de aceptación

En estos criterios, "valor efectivo" de una clave es el guardado en `configuraciones` si es válido según la tabla de
claves del contrato, y si no hay fila o no es válido, el valor por defecto de esa tabla. A y B son dos academias
activas. "Ruta de academia", "sesión válida" y "actor vigente" son los de la spec 002.

### A. Lectura y valores por defecto

1. Dada una academia sin filas en `configuraciones`, cuando un `ADMIN` pide `GET /api/configuracion`, entonces responde
   200 con `{ configuracion }` y los valores por defecto: `toleranciaTardanzaMinutos` 10 (D-11), `diasPorVencer` 5
   (HU-11), `diasPrioridadRenovacion` 5 (D-06), `intentosInicioSesion` 5 y `minutosBloqueo` 15 (D-07, DR-3 de 002) y
   `telefono` `null` (D-22). Crear una academia (001) no inserta filas de configuración. _(prueba obligatoria)_
2. Dada una academia con filas válidas para algunas claves, cuando se pide `GET /api/configuracion`, entonces responde
   los valores guardados de esas claves y los valores por defecto de las demás. Las filas con claves que no están en la
   tabla del contrato se ignoran y no aparecen en la respuesta. _(prueba obligatoria)_
3. **Valor guardado inválido.** Dada una fila de una clave del contrato con un valor que no cumple su tabla (escrita
   directamente en la base por el dueño de las tablas): un texto, un booleano, un objeto, una lista, JSON `null` en una
   clave numérica, un número con decimales, uno fuera de rango o un teléfono con formato inválido, entonces
   `GET /api/configuracion` responde 200 con el valor por defecto de esa clave (nunca 500) y el registro técnico anota un
   aviso con la academia y la clave, sin el valor guardado. _(prueba obligatoria; el efecto en el bloqueo es el criterio
   16)_
4. **Aislamiento.** Dadas A y B con valores distintos guardados, cuando un `ADMIN` de A pide `GET` o
   `PATCH /api/configuracion`, entonces solo lee y escribe filas de A: la respuesta nunca trae valores de B, y tras el
   `PATCH` las filas de B (valor y `actualizado_en`) siguen iguales y la auditoría de B no cambia. Un cuerpo con
   `academiaId` (o cualquier campo que no sea del contrato) responde 400 sin escribir nada, y un parámetro de consulta
   (`?academiaId=<id de B>`) no cambia la academia. Lo mismo con `GET /api/mi-academia` (criterio 20). _(crítico)_ (D-23;
   criterio 20 de 002)

   _Precisión del orquestador (17/11/2026), implícita en las pruebas protegidas:_ un parámetro de consulta
   `?academiaId=<id de B>` en `GET` o `PATCH /api/configuracion` o en `GET /api/mi-academia` se ignora (200 con los
   datos de la academia de la sesión) o se rechaza con 400; las dos respuestas son válidas, pero nunca muestra datos de
   B ni escribe en B.
5. **Permisos.** Dadas sesiones válidas de cada rol de A, entonces `GET` y `PATCH /api/configuracion` responden 200 al
   `ADMIN` y 403 `SIN_PERMISO` a `SECRETARIA`, `ENTRENADOR` y `ALUMNO`, sin escribir ni auditar nada; sin sesión, 401
   `NO_AUTENTICADO`; con el cambio de contraseña pendiente, 403 `CAMBIO_DE_CLAVE_OBLIGATORIO`; con A suspendida, 403
   `ACADEMIA_SUSPENDIDA`, en el orden de comprobaciones de 002. `MATRIZ_PERMISOS` suma la fila `CONFIGURAR_ACADEMIA` con
   `ADMIN: 'TODO'` y nada más (24 filas). El Superadmin no tiene ruta para ver ni cambiar la configuración de una
   academia (D-29). _(crítico)_ (sección 2.1, D-11, D-29)

   _Precisión del orquestador (17/11/2026), implícita en las pruebas protegidas:_ como el Superadmin no tiene ruta de
   configuración de academia, su cookie (`aq_plataforma`) en `GET` o `PATCH /api/configuracion` responde 401, igual que
   en cualquier ruta de academia (criterio 19 de 002), sin leer ni escribir nada.
6. **Función para las historias siguientes.** `leerConfiguracion(tx)` devuelve los valores efectivos de la academia de
   la transacción que recibe (`tx.academiaId`), con una sola consulta dentro de esa transacción y sin guardar nada entre
   llamadas (sin caché, regla de `docs/arquitectura.md`). Prueba: con valores distintos en A y en B, `conAcademia(A, tx
   => leerConfiguracion(tx))` devuelve los de A; un cambio confirmado se ve en la siguiente llamada. El cálculo del valor
   efectivo (por defecto, válido, inválido) es una función pura del dominio con pruebas unitarias en los bordes de cada
   rango. _(prueba obligatoria)_

### B. Cambios del administrador

7. Dado un `ADMIN` de A, cuando envía `PATCH /api/configuracion` con uno o más campos de `actualizarConfiguracionSchema`
   válidos, entonces responde 200 con `{ configuracion }` (todos los valores efectivos, ya con el cambio); guarda una fila
   por cada campo que cambió (insertándola o actualizándola) con `actualizado_en` igual a `RELOJ.ahora()`; no toca los
   campos que no envió; y registra un solo `CONFIGURACION_ACTUALIZADA` (entidad `configuracion`, actor `USUARIO` con su
   id, IP) con `datosAntes` y `datosDespues` solo de los campos que cambiaron, con los nombres de la API y los valores
   efectivos. _(prueba obligatoria)_ (D-11, RN-22, RNF-06)
8. Dado un cuerpo inválido, entonces responde 400 `SOLICITUD_INVALIDA` sin escribir ni auditar nada: un cuerpo que no es
   JSON; `{}` (sin ningún campo); un campo que no es del contrato (por ejemplo `nombre`, `logo` o `academiaId`); un
   número no entero, un texto aunque tenga dígitos (`"10"`), un booleano o `null` en un campo numérico; un valor fuera
   del rango de la tabla de claves (los límites son inclusivos: el mínimo y el máximo se aceptan, uno menos o uno más
   no); o un `telefono` que no cumple su formato. `detalles.errores[].campo` indica el campo. _(prueba obligatoria)_
9. **Idempotente.** Dado un `PATCH` cuyos valores ya son los guardados (o, sin fila, los valores por defecto), entonces
   responde 200 sin escribir filas ni auditar. Dos envíos seguidos del mismo cambio (doble clic) dejan una sola
   `CONFIGURACION_ACTUALIZADA`. Si la fila guardada es inválida (criterio 3), enviar ese campo siempre escribe el valor
   nuevo, aunque sea igual al por defecto. _(prueba obligatoria)_
10. **Teléfono.** `telefono` se recorta; tras recortar debe tener de 6 a 20 caracteres, solo dígitos `0-9`, espacios,
    guiones, paréntesis y un `+` opcional al inicio, con al menos 6 dígitos. Con `null` se quita el teléfono: la
    respuesta y `GET /api/mi-academia` traen `telefono: null`. _(prueba obligatoria)_ (D-22; formato provisional,
    pregunta N1)
11. **El administrador sigue vigente dentro de la transacción.** `PATCH /api/configuracion` llama a
    `bloquearActorVigente` como primera sentencia de su `conAcademia` (regla DT-5 de 002). Prueba de carrera
    determinista, como la del criterio 56 de 002: la prueba desactiva al `ADMIN` X (`estado = 'INACTIVO'`,
    `version_token + 1`) en una transacción sin confirmar; X envía un `PATCH` válido, que pasa el middleware y queda
    esperando el bloqueo; la prueba confirma. Entonces la respuesta es 401 `NO_AUTENTICADO`, ninguna fila de
    `configuraciones` cambia y no hay `CONFIGURACION_ACTUALIZADA`. Lo mismo si lo que sube es solo `version_token`
    (cierre de sesión en otro dispositivo). _(crítico)_ (DT-5 de 002)
12. **Dos administradores a la vez.** Dados dos `PATCH` simultáneos de dos `ADMIN` de A sobre el mismo campo con
    valores distintos, entonces los dos responden 200 (nunca 500 ni `40P01`), el valor final es el de uno de ellos y hay
    dos `CONFIGURACION_ACTUALIZADA` encadenadas: el `datosAntes` de la segunda es el `datosDespues` de la primera.
    Sobre campos distintos, se conservan los dos cambios. _(prueba obligatoria; varias rondas, sin depender de tiempos)_

### C. Bloqueo por intentos fallidos con los valores de cada academia

13. Dadas A con `intentosInicioSesion` 3 y `minutosBloqueo` 30 y B sin configuración, y el mismo DNI con cuenta en las
    dos, cuando se intenta entrar por `POST /api/a/{nombreCorto}/sesion` con la clave equivocada, entonces en A los 2
    primeros fallos responden 401 y el 3.º responde 423 `CUENTA_BLOQUEADA` con `bloqueado_hasta = ahora + 30 min`
    (`RelojFijo`); mientras dure, todo intento responde 423, incluso con la clave correcta; a los 30 minutos, la clave
    correcta entra y deja el contador en 0. En B, los 4 primeros responden 401 y el 5.º 423 con `ahora + 15 min`. Dados
    10 intentos fallidos simultáneos contra la cuenta de A, cada respuesta es 401 o 423, al menos una es 423 y la cuenta
    queda bloqueada. _(crítico)_ (D-07, criterio 9 de 002)

    _Precisión del orquestador (17/11/2026), implícita en las pruebas protegidas:_ con N intentos configurados, entre
    los 10 intentos simultáneos con la clave equivocada como mucho N−1 responden 401 y el resto 423 (con
    `intentosInicioSesion` 3 en A, como mucho 2 responden 401): cada fallo cuenta una vez y el N-ésimo bloquea.
14. Dada A con `intentosInicioSesion` 3, cuando un usuario de A envía `POST /api/sesion/clave` con la `claveActual`
    equivocada, entonces el 3.º fallo responde 423 y bloquea la cuenta por los `minutosBloqueo` de A, con el resto de
    reglas de los criterios 24, 58 y 60 de 002. _(crítico)_
15. **Cambiar los valores con cuentas a medias.** Dada una cuenta de A:
    - a) con 3 fallos seguidos y los valores por defecto, cuando el administrador pone `intentosInicioSesion` en 3,
      entonces el siguiente fallo responde 423 y la bloquea (el contador llega a 4, que alcanza el máximo);
    - b) bloqueada hasta T, cuando el administrador cambia `minutosBloqueo` o `intentosInicioSesion`, entonces sigue
      bloqueada hasta T exactamente: el cambio no alarga ni acorta un bloqueo ya puesto;
    - c) bloqueada, cuando se restablece su contraseña, entonces queda desbloqueada como dice el criterio 35 de 002.

    _(crítico)_
16. **Valor guardado inválido en el bloqueo.** Dadas en A filas de `intentos_inicio_sesion` o `minutos_bloqueo` con
    cualquiera de los valores inválidos del criterio 3 (también `0`, negativos, `1000` o `2.5`), entonces el inicio de
    sesión y el cambio de contraseña usan el valor por defecto de esa clave (5 o 15): la cuenta se bloquea al 5.º fallo
    por 15 minutos, nunca queda sin bloqueo ni responde 500. _(crítico)_
17. **El mismo trabajo en la base, con configuración.** Dadas filas de `intentos_inicio_sesion` y `minutos_bloqueo` en A
    y otras distintas en B, entonces los cuatro casos del criterio 53 de 002 (DNI activo de A, inactivo de A, inexistente
    y solo de B, por la ruta de A y con la clave equivocada) cumplen sus puntos a) a d): la misma secuencia de sentencias
    SQL, en la que la lectura de la configuración es la misma sentencia y ocurre en el mismo lugar en los cuatro casos.
    La prueba protegida del criterio 53 de 002 no cambia y sigue pasando. _(crítico)_ (criterio 53 de 002)
18. El bloqueo del Superadmin (`REGLAS_BLOQUEO_SUPERADMIN`, 5 intentos y 15 minutos, DR-3 de 001) no cambia con la
    configuración de ninguna academia. _(prueba obligatoria)_
19. El mensaje del 423 `CUENTA_BLOQUEADA` de las rutas de academia dice cuántos minutos faltan, calculados con
    `bloqueado_hasta` y `RELOJ`, redondeados hacia arriba y como mínimo 1, sin leer nada más de la base. La web del
    ingreso a la academia y del cambio de contraseña deja de decir "15 minutos" fijo
    (`frontend/src/modulos/sesion/mensajes.ts`): muestra el mensaje de la API y agrega que se puede pedir en recepción
    que restablezcan la contraseña. El mensaje del Superadmin no cambia. _(prueba obligatoria: unitaria del mensaje y de
    componentes de la web; las pruebas de integración siguen comprobando el código y el estado, no el texto)_

### D. Identidad de la academia (D-22)

20. Dada una sesión válida de cualquier rol de A, cuando pide `GET /api/mi-academia`, entonces responde 200 con
    `{ academia: { nombre, nombreCorto, telefono } }` de la academia de su sesión: el `nombre` y el `nombreCorto` de
    `academias` y el `telefono` efectivo. No recibe parámetros; con el cambio de contraseña pendiente responde 403 como
    toda ruta de academia. _(prueba obligatoria)_ (D-22, D-23)
21. Las rutas públicas no cambian: `GET /api/a/{nombreCorto}` sigue respondiendo solo `{ nombreCorto, nombre }`
    (pruebas protegidas de 001), y el teléfono no se publica en ninguna ruta sin sesión en esta historia (pregunta N4).
    El nombre de la academia no se cambia desde la configuración (pregunta N2). _(prueba obligatoria: las de 001
    siguen pasando)_

### E. Web

22. Dado un `ADMIN`, el menú del panel muestra "Configuración" (según `puede(rol, 'CONFIGURAR_ACADEMIA')`) y
    `/panel/configuracion` muestra el formulario; a los demás roles el menú no lo muestra y la página responde con el
    mensaje de "sin permiso" de 002 (`RequierePermiso`). _(prueba obligatoria, de componentes)_
23. El formulario se llena con `GET /api/configuracion`, agrupado en "Asistencia y mensualidades" (tolerancia, días por
    vencer, días de prioridad), "Seguridad del inicio de sesión" (intentos y minutos de bloqueo) e "Identidad" (nombre de
    solo lectura y teléfono). Cada campo explica qué hace, su unidad, su rango y su valor por defecto, con un botón "Usar
    el valor por defecto". Valida con el esquema compartido antes de enviar, envía solo los campos que cambiaron (sin
    cambios, el botón Guardar está desactivado), muestra junto a cada campo los errores 400 de la API y, al guardar,
    muestra un aviso de éxito y los valores que devolvió la API. Vaciar el teléfono envía `null`. _(prueba obligatoria,
    de componentes)_
24. El diseño del panel muestra el nombre de la academia y, si lo hay, su teléfono, leídos de `GET /api/mi-academia`;
    si esa petición falla, el panel funciona igual, sin teléfono. _(prueba obligatoria, de componentes)_

### F. Semilla y documentación

25. La semilla deja a `delfines` con un teléfono de ejemplo inventado y a `tiburones` sin configuración (valores por
    defecto), y se puede ejecutar dos veces sin duplicar ni fallar. _(verificación del revisor)_
26. `docs/arquitectura.md` documenta las claves, sus valores por defecto, `leerConfiguracion(tx)` y la regla para las
    historias siguientes (leer en la propia transacción, sin caché; un valor inválido vale lo de por defecto); el
    `README.md` y la guía de uso explican la pantalla. _(verificación del revisor)_

## Casos límite

- **Academias creadas antes de esta historia:** no tienen filas; valen los valores por defecto, sin migración de datos.
- **Bordes de los rangos:** tolerancia 0 (solo es puntual quien marca en el minuto de inicio, regla de 009) y 30 se
  aceptan; 31 y -1 no. `10.0` y `1e1` llegan como el número 10 tras leer el JSON y se aceptan; `10.5` y `1e400`
  (infinito) no.
- **Teléfono con espacios en los extremos, con dígitos de otros alfabetos o con caracteres de control:** se recorta en
  el primer caso; los otros dos responden 400.
- **Bajar el máximo de intentos por debajo de los fallos que ya tiene una cuenta:** el siguiente fallo la bloquea
  (criterio 15 a), pero la clave correcta todavía entra: el bloqueo lo decide `bloqueado_hasta`, no el contador.
  Subirlo no desbloquea a nadie.
- **Cambiar los minutos de bloqueo con cuentas bloqueadas:** cada cuenta conserva su `bloqueado_hasta` (criterio 15 b).
- **El administrador baja sus propios valores y se equivoca al entrar:** le aplican como a todos; otro administrador o
  el Superadmin lo restablecen (criterios 35 y 40 de 002).
- **Fila con una clave desconocida** (de pruebas o de una historia futura): se ignora.
- **Fila inválida y luego un `PATCH` de ese campo:** se escribe y queda reparada (criterio 9); la auditoría muestra como
  "antes" el valor por defecto que se estaba usando.
- **Academia suspendida mientras el administrador guarda:** la escritura en curso termina (riesgo aceptado de 002,
  "Escrituras en curso al suspender la academia"); la siguiente petición responde 403.
- **Hora del servidor en otra zona:** esta historia solo guarda instantes (`actualizado_en`, `bloqueado_hasta`); los días
  "por vencer" y de prioridad se cuentan en America/Lima en la 010.

## Reglas de negocio aplicables

- **D-07:** configuración clave/valor por academia con tolerancia, días "por vencer", días de prioridad, intentos y
  tiempo de bloqueo.
- **D-11 y D-16:** puntual hasta la tolerancia (10 minutos por defecto) y tarde después; la usa la 009.
- **HU-11:** "por vencer" en los últimos 5 días, configurable; lo usa la 010.
- **D-06:** prioridad para conservar el horario durante los últimos N días del mes (por defecto, los mismos 5 días de
  "por vencer"); la usa la 010.
- **D-22 y D-23:** nombre, teléfono y logo de cada academia, sin tocar el código.
- **HU-05, RNF-03, sección 11.4, DR-3 de 002:** bloqueo tras varios intentos fallidos; hasta ahora fijo en 5 y 15.
- **D-29:** el Superadmin no ve la configuración interna de las academias.
- **RN-22 y RNF-06:** auditoría de quién cambió qué y cuándo.
- **Reglas para las historias siguientes de `docs/arquitectura.md`:** `bloquearActorVigente` como primera sentencia de
  toda escritura de un usuario de la academia; `@Permiso` o `@SoloSesion` en cada manejador; cada paso con `await`;
  varias filas con una sola sentencia; sin caché de datos en los servicios; errores de la base con
  `errorParaRegistro`.

## Contrato

### Rutas

Mismas reglas que 002: `Cache-Control: no-store`, cuerpos JSON con esquemas estrictos y las reglas de cuerpos de 001;
orden de comprobaciones sesión → academia activa → cambio obligatorio → permiso → cuerpo → operación.

| Método y ruta | Sesión | Permiso | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- | --- |
| `GET /api/configuracion` | sí | `CONFIGURAR_ACADEMIA` | — | 200 `RespuestaConfiguracion` | 401, 403 |
| `PATCH /api/configuracion` | sí | `CONFIGURAR_ACADEMIA` | `actualizarConfiguracionSchema` | 200 `RespuestaConfiguracion` | 400, 401, 403 |
| `GET /api/mi-academia` | sí | `@SoloSesion` | — | 200 `RespuestaMiAcademia` | 401, 403 |

En el `PATCH`, el 401 incluye el caso del criterio 11 (el actor dejó de estar vigente mientras la petición estaba en
curso).

### Tabla de claves (valores por defecto y rangos provisionales; pregunta N1)

| Campo de la API | Clave en `configuraciones` | Tipo | Por defecto | Mínimo | Máximo | Origen |
| --- | --- | --- | --- | --- | --- | --- |
| `toleranciaTardanzaMinutos` | `tolerancia_tardanza_minutos` | entero | 10 | 0 | 30 | D-11 |
| `diasPorVencer` | `dias_por_vencer` | entero | 5 | 1 | 15 | HU-11 |
| `diasPrioridadRenovacion` | `dias_prioridad_renovacion` | entero | 5 | 1 | 15 | D-06 (pregunta N3) |
| `intentosInicioSesion` | `intentos_inicio_sesion` | entero | 5 | 3 | 10 | D-07, DR-3 de 002 |
| `minutosBloqueo` | `minutos_bloqueo` | entero | 15 | 5 | 60 | D-07, DR-3 de 002 |
| `telefono` | `telefono` | texto o `null` | `null` | criterio 10 | | D-22 |

`valor` guarda el JSON del valor tal cual: un número (`10`), un texto (`"01 555 0000"`) o `null` (sin teléfono).

### Esquemas compartidos (`packages/contratos/src/configuracion.ts`)

- `CLAVES_CONFIGURACION`, `CONFIGURACION_POR_DEFECTO` y `LIMITES_CONFIGURACION`: la tabla de claves, para la API y la
  web.
- `telefonoAcademiaSchema`: criterio 10.
- `configuracionAcademiaSchema` (estricto): los seis campos de la tabla, todos presentes.
- `actualizarConfiguracionSchema` (estricto): los seis campos opcionales, al menos uno; enteros en rango; `telefono`
  texto o `null`.
- `respuestaConfiguracionSchema`: `{ configuracion: configuracionAcademiaSchema }`.
- `respuestaMiAcademiaSchema`: `{ academia: { nombre; nombreCorto; telefono: string | null } }`.
- `permisos.ts`: `CONFIGURAR_ACADEMIA` en `PERMISOS` y en `MATRIZ_PERMISOS` con `{ ADMIN: 'TODO' }`.

### Matriz de permisos

| Permiso | Origen | ADMIN | SECRETARIA | ENTRENADOR | ALUMNO |
| --- | --- | --- | --- | --- | --- |
| `CONFIGURAR_ACADEMIA` | D-11 ("el administrador puede cambiarlos"), D-07, D-22 | `TODO` | | | |

### Para las historias siguientes (backend)

```ts
// backend/src/modulos/configuracion/index.ts
interface ConfiguracionAcademia { toleranciaTardanzaMinutos: number; diasPorVencer: number;
  diasPrioridadRenovacion: number; intentosInicioSesion: number; minutosBloqueo: number; telefono: string | null }
// Valores efectivos de tx.academiaId, con una consulta en la transacción de quien llama. Sin caché.
function leerConfiguracion(tx: TransaccionAcademia,
  opciones?: { registro?: { warn(contexto: object, mensaje: string): void } }): Promise<ConfiguracionAcademia>;
```

### Auditoría y registro técnico

- Acción `CONFIGURACION_ACTUALIZADA`, entidad `configuracion`, `entidadId` nulo, `datosAntes` y `datosDespues` con los
  campos que cambiaron (criterio 7).
- Aviso del registro técnico por valor inválido: academia y clave, sin el valor (criterio 3).

### Códigos de error

Ninguno nuevo; se reutilizan los de 000, 001 y 002.

### Eventos

Ninguno.

## Cambios al modelo de datos

Ninguno: sin migración. Se usa la tabla `configuraciones` de 001 (`academia_id`, `clave`, `valor jsonb`,
`actualizado_en`; PK `(academia_id, clave)`; RLS forzada; `SELECT`, `INSERT` y `UPDATE` para `aquagestion_app`), con
las claves de la tabla de claves. No se agregan privilegios (no hace falta `DELETE`: quitar el teléfono guarda JSON
`null`) ni `CHECK` por clave (decisión D3).

## Fuera de alcance

- **Logo de la academia** (pregunta N5): necesita `AlmacenArchivos`, que todavía no existe.
- **Cambiar el nombre de la academia** (pregunta N2) y **publicar el teléfono en las páginas públicas** (pregunta N4).
- **Usar la tolerancia** (puntual o tarde): 009. **Usar "por vencer" y la prioridad:** 010.
- **Espera antes de registrar las faltas** (pregunta N6): 009.
- **Régimen tributario** (D-23): con la facturación (D-09).
- **Otros valores:** la duración de las sesiones, el límite por IP del ingreso y las reglas de la contraseña siguen
  fijos (no están en D-07). El bloqueo del Superadmin sigue fijo (criterio 18).
- **Ver el historial de cambios por pantalla:** con la auditoría de la Fase 3.
- **Caché de la configuración.**

## Impacto en especificaciones anteriores

- **001, DR-8:** se cumple. Ni la tabla, ni sus políticas, ni `PRIVILEGIOS_APP` cambian; crear una academia sigue sin
  insertar configuración, así que `crearDatosDeAislamiento` y sus conteos no cambian.
- **001, `GET /api/a/{nombreCorto}`:** no cambia (criterio 21).
- **002, criterio 9 y DR-3:** 5 intentos y 15 minutos pasan a ser los valores por defecto; sin filas, el criterio 9 y
  sus pruebas protegidas siguen igual. `REGLAS_BLOQUEO_USUARIO` deja de ser una constante y sale de
  `leerConfiguracion`.
- **002, criterio 26 (prueba protegida `packages/contratos/src/permisos.test.ts`):** la matriz pasa de 23 a 24 filas.
  La actualiza el test-writer en el commit de pruebas protegidas de 003, solo para sumar `CONFIGURAR_ACADEMIA`, sin
  quitar nada de lo que comprueba (pregunta T1). El texto del contrato de 002 no se edita; esta spec lo amplía.
- **002, criterio 53:** no cambia; el criterio 17 lo extiende al caso con filas de configuración.
- **002, mensaje del 423:** en la API y en la web de la academia pasa de "15 minutos" fijo a los minutos que faltan
  (criterio 19). Las pruebas de 002 no miran ese texto (la de la web de la plataforma sí, y no cambia).
- **002, "Fuera de alcance: configurar los intentos y el tiempo de bloqueo: 003":** se cumple aquí.
- **Web de 002:** el menú del panel suma "Configuración"; `LayoutPanel` muestra el teléfono.
- **`docs/arquitectura.md`:** "Lo que no hace la 001… la configuración con sus claves (la define la 003)" se actualiza
  (criterio 26).

## Riesgos aceptados

- **El administrador puede aflojar el bloqueo dentro del rango** (hasta 10 intentos y solo 5 minutos). Es lo que pide
  D-07; lo acotan los rangos (pregunta N1), el límite por IP (criterio 12 de 002) y la auditoría.
- **El último en guardar el mismo campo gana:** dos administradores que cambian el mismo campo a la vez no se avisan;
  los dos cambios quedan en la auditoría (criterio 12). Como el `PATCH` solo envía lo que cambió, los cambios en campos
  distintos no se pisan.
- **Un valor inválido escrito a mano en la base se reemplaza en silencio por el de por defecto,** con un aviso en el
  registro técnico (criterio 3). La API nunca escribe valores inválidos; solo puede pasar con un acceso directo a la base.
- **Una consulta más en cada intento fallido de ingreso** (leer la configuración en la transacción del conteo). Es una
  lectura por clave primaria; no se cachea por la regla de `docs/arquitectura.md`.
- **Los cambios valen desde ese momento:** no se recalcula nada de lo ya registrado (pregunta N7).

## Decisiones

**Cómo se citan.** Las decisiones del responsable de esta spec se citan como "DR-n" en esta sección y como "DR-n de
003" fuera de ella; las del orquestador, "DT-n" y "DT-n de 003". Los criterios, el contrato y las demás secciones se
escribieron antes de la aprobación y no cambian: donde dicen "pregunta Nn" se refieren a DR-n de 003 y donde dicen
"pregunta Tn", a DT-n de 003. Los valores que la spec llama "provisionales" (rangos de la tabla de claves, formato del
teléfono del criterio 10 y prioridad aparte de "por vencer") quedan aprobados para el MVP.

### Decisiones del responsable (17/11/2026)

Bryan aprobó la especificación y aceptó la propuesta de cada pregunta de negocio ("de acuerdo con todas, apruebo la
003"). Se conserva el texto de cada pregunta y su propuesta, que es lo decidido.

- **DR-1 (pregunta N1). ¿Qué rangos se permiten?** Los documentos dicen los valores por defecto, pero no los límites.
  **Decidido (la propuesta):** tolerancia de 0 a 30 minutos (la clase dura 1 hora); "por vencer" y prioridad de 1 a
  15 días; intentos de 3 a 10; bloqueo de 5 a 60 minutos (por debajo de 3 intentos o 5 minutos el bloqueo molesta más
  de lo que protege, y por encima de 10 o 60 deja de proteger o castiga demasiado). Teléfono de 6 a 20 caracteres con
  dígitos, espacios, guiones, paréntesis y `+` (tabla de claves y criterio 10).
- **DR-2 (pregunta N2). ¿El administrador puede cambiar el nombre de la academia?** D-22 dice que el nombre se lee de
  la configuración; hoy el nombre está en `academias` y solo lo pone el Superadmin al crearla (no hay ruta para
  cambiarlo). **Decidido (la propuesta):** no en esta historia; el nombre ya es un dato y no código, que es lo que pide
  D-22. Si hace falta cambiarlo, se agrega una ruta del Superadmin con auditoría en una historia pequeña (criterio 21).
- **DR-3 (pregunta N3). ¿Los días de prioridad al renovar siguen a los días "por vencer" o son un valor aparte?** D-06
  dice "por defecto, los mismos 5 días de por vencer". **Decidido (la propuesta):** un valor aparte que empieza en 5;
  si el administrador cambia "por vencer", la prioridad no cambia sola (la pantalla muestra los dos juntos para que lo
  vea) (criterio 23).
- **DR-4 (pregunta N4). ¿El teléfono se muestra en las páginas públicas** (ingreso, inscripción, seguimiento)?
  **Decidido (la propuesta):** sí, pero desde la 005, que pone en uso las páginas públicas y decide el límite de
  peticiones de las rutas públicas (nota de 005 del backlog). En la 003 solo se ve con sesión (criterio 21).
- **DR-5 (pregunta N5). ¿El logo entra en esta historia?** Subirlo y servirlo necesita `AlmacenArchivos` y `sharp`
  (D-21, D-25), que todavía no existen. **Decidido (la propuesta):** no; mientras tanto vale la identidad genérica sin
  logo (D-22). `AlmacenArchivos` se diseña con los comprobantes y las fotos de la 005, que son ruta crítica (entradas
  públicas), y el logo se agrega justo después, en una historia corta (por ejemplo 005b), con su ruta pública.
- **DR-6 (pregunta N6). ¿Hay una espera entre el fin de la clase y el registro de la falta?** La HU-42 hablaba de 15
  minutos, pero se eliminó con WhatsApp (D-08), y D-08 solo dice "al terminar cada clase, más la tolerancia".
  **Decidido (la propuesta):** se decide en la 009; no se agrega ninguna clave ahora. Mientras tanto, la lectura
  natural de D-16 es registrar la falta al terminar la clase, y la secretaria la corrige con la asistencia manual con
  motivo.
- **DR-7 (pregunta N7). ¿Un cambio de la tolerancia o de "por vencer" afecta lo ya registrado?** **Decidido (la
  propuesta):** no; vale desde que se guarda. Una asistencia ya marcada como puntual o tarde no cambia (riesgo
  aceptado "Los cambios valen desde ese momento").

### Decisiones técnicas del orquestador (17/11/2026)

El orquestador aprobó las tres propuestas técnicas tal como estaban. Se conserva el texto de cada pregunta y su
propuesta.

- **DT-1 (pregunta T1). Permiso nuevo y prueba protegida de 002.** **Decidido (la propuesta):** `CONFIGURAR_ACADEMIA`
  (solo `ADMIN`) en lugar de reutilizar `CONFIGURAR_PLANES_HORARIOS_AFORO`, que es otra fila de la sección 2.1. Obliga
  a sumar la fila en la prueba protegida del criterio 26 de 002 (23 → 24); lo hace el test-writer en el commit
  "Pruebas protegidas (003)", sin quitar nada (criterio 5).
- **DT-2 (pregunta T2). Clasificación "en parte".** El backlog marcaba la 003 como no crítica. **Decidido (la
  propuesta):** "en parte", con los criterios 4, 5, 11 y 13 a 17 críticos, porque cambia el bloqueo del inicio de
  sesión (autenticación) y es un dato por academia (aislamiento). La columna "Ruta crítica" del backlog pasa a "En
  parte".
- **DT-3 (pregunta T3). Sin migración.** **Decidido (la propuesta):** valores por defecto en el código y sin `CHECK`
  por clave (decisiones D1 y D3).

### Decisiones de diseño (técnicas)

Propuestas del especificador, aprobadas con la spec (17/11/2026).

- **D1. Los valores por defecto viven en el código** (`CONFIGURACION_POR_DEFECTO`, en los contratos) y una clave sin
  fila vale lo de por defecto. Alternativa descartada: insertar las filas al crear cada academia (desde
  `comoPlataforma` la RLS de `configuraciones` no deja escribir, mezclaría la plataforma con datos internos, D-29, y
  cambiaría los conteos de las pruebas de 001) o con una migración de datos (las academias nuevas quedarían sin filas).
- **D2. `valor` guarda el JSON escalar** (`10`, `"01 555 0000"`, `null`). Alternativa descartada: un objeto
  `{ "valor": … }` (más largo y sin ventaja).
- **D3. Sin `CHECK` por clave en la base:** se valida al escribir (zod) y al leer (valor inválido → por defecto,
  criterios 3 y 16). Alternativa descartada: un `CHECK` por clave (cada clave nueva exigiría una migración y no cubre el
  caso del dueño de las tablas, que puede quitarlo).
- **D4. `PATCH` parcial con un bloqueo de transacción por academia** (`pg_advisory_xact_lock`) después de
  `bloquearActorVigente`: los cambios a la misma academia se ordenan y la auditoría queda encadenada (criterio 12).
  Alternativa descartada: `PUT` con todos los campos (pisa los cambios de otro administrador en otros campos) o una
  versión optimista con 409 (más trabajo para la web; se puede agregar si molesta el "último gana").
- **D5. La configuración se lee en la transacción que cuenta el fallo,** con la misma sentencia exista o no la cuenta
  (criterio 17). Alternativa descartada: leerla antes solo cuando hay cuenta (rompe el criterio 53 de 002).
- **D6. `leerConfiguracion` es una función sin Nest** (como `insertarEnAuditoriaDeAcademia`), para que `autenticacion` la
  use sin que los módulos `autenticacion` y `configuracion` dependan uno del otro. Alternativa descartada: inyectar un
  `ConfiguracionService` en `SesionAcademiaService` (dependencia circular, porque `configuracion` usa los decoradores y
  `bloquearActorVigente` de `autenticacion`).
- **D7. Identidad para la sesión en `GET /api/mi-academia`** (`@SoloSesion`), sin tocar `GET /api/a/{nombreCorto}`
  (sus pruebas protegidas exigen exactamente `nombre` y `nombreCorto`) ni `RespuestaSesionAcademia` (esquema estricto de
  002). Alternativa descartada: agregar el teléfono a esas respuestas.
- **D8. Los cambios de configuración se auditan** (`CONFIGURACION_ACTUALIZADA`): cambian la seguridad del ingreso y cómo
  se registrará la asistencia. RNF-06 no los nombra; se tratan como un ajuste.

## Preguntas abiertas

Ninguna. Las preguntas N1 a N7 y T1 a T3 quedaron decididas el 17/11/2026 (DR-1 a DR-7 y DT-1 a DT-3, en
"Decisiones").
