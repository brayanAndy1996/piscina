# 002 · Autenticación y roles por academia

- **Historias y requerimientos:** HU-05 (acceso con DNI, cambio de contraseña, restablecimiento por la secretaria),
  RN-02 (usuario y contraseña inicial iguales al DNI, cambio obligatorio), RN-03 ajustada por D-28 (DNI único por
  academia), RN-29 y D-14 (el apoderado usa la cuenta del alumno; solo puede cambiar la contraseña), RNF-03
  (argon2 y control de acceso por roles), RNF-04 (cambio obligatorio en el primer ingreso), RNF-05 (Ley 29733),
  RNF-06 y RN-22 (auditoría), RNF-12 (America/Lima), sección 2.1 (matriz de permisos), sección 8.7 (el
  administrador gestiona "usuarios"), sección 9.1 (entidad `USUARIO`), sección 11.4 (riesgo "contraseña igual al
  DNI": cambio obligatorio y bloqueo). Decisiones: D-07 (`intentos_fallidos`, `bloqueado_hasta`, `ultimo_acceso`),
  D-10 y D-25 (JWT en cookie `httpOnly` con versión de token, guards de NestJS, `@node-rs/argon2`,
  `@nestjs/throttler`), D-17 (la tabla de usuarios la crea 002), D-23 (aislamiento), D-27 y D-28 (ingreso en
  `/a/{academia}/ingresar`), D-29 y DR-1 de la spec 001 (el Superadmin crea el primer administrador de cada
  academia, y lo hace esta historia).
- **Ruta crítica:** sí, casi toda: autenticación, permisos y aislamiento entre academias (lista de `CLAUDE.md`). No
  son críticos: los mensajes y pantallas de la web, la semilla y la documentación.
- **Estado:** borrador (13/11/2026)

## Objetivo

Que cada persona de una academia entre al sistema con su DNI por la página de su academia
(`/a/{nombreCorto}/ingresar`), con la contraseña inicial igual a su DNI y el cambio obligatorio en el primer ingreso,
y que solo pueda hacer lo que su rol permite según la matriz de permisos. El Superadmin crea al primer administrador
de cada academia; el administrador crea y desactiva al personal (administradores, secretarias y entrenadores); la
secretaria restablece la contraseña de un alumno que la olvidó. Toda la sesión y todas las consultas quedan atadas a
la academia del usuario: nadie puede leer ni tocar usuarios de otra academia.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **A. Usuarios y aislamiento (1 a 4):** la tabla `usuarios` es la primera tabla del negocio con datos personales;
  una política o un privilegio de más, o un DNI único global, mezclarían academias o revelarían que un DNI existe en
  otra (D-23, D-28).
- **B. Inicio de sesión (5 a 13):** autenticación: argon2, contraseña inicial igual al DNI, bloqueo, límite por IP,
  respuestas que no revelan si un DNI existe, y la academia correcta en la sesión (RN-02, RNF-03, D-07).
- **C. Sesión (14 a 20):** una sesión falsificada, de otra academia, de una cuenta desactivada o de una academia
  suspendida daría acceso a datos que no le corresponden (D-23, DR-4 de 001). El criterio 20 cierra el riesgo que la
  001 dejó a esta historia: la academia sale siempre de la sesión.
- **D. Cambio de contraseña (21 a 25):** RN-02 y RNF-04: sin el cambio obligatorio, la cuenta queda con una
  contraseña que cualquiera que conozca el DNI puede adivinar.
- **E. Permisos (26 a 28):** la matriz de la sección 2.1; una ruta sin permiso declarado o un rol que pasa donde no
  debe es exactamente el error de "permisos" de la ruta crítica.
- **F y G. Gestión de usuarios y restablecimiento (29 a 37):** crear, desactivar o restablecer una cuenta es tomar el
  control de ella; debe quedar dentro de la academia y del rol que lo permite, y en auditoría.
- **H. Superadmin y administradores (38 a 41):** D-29: el Superadmin entra en una academia solo para sus
  administradores y nunca ve ni toca otros datos internos.
- **I. Auditoría y registro técnico (42 y 43):** RN-22 y RNF-06; Ley 29733: ni la contraseña ni el DNI escrito al
  ingresar llegan al registro técnico.

No son críticos, pero llevan _(prueba obligatoria)_ o la verificación indicada: 44 a 52 (esquemas, semilla, web,
E2E y documentación).

## Criterios de aceptación

En estos criterios, "personal" son los usuarios con rol `ADMIN`, `SECRETARIA` o `ENTRENADOR`; "ruta de academia" es
toda ruta bajo `/api/` salvo `/api/salud`, `/api/plataforma/…` y `/api/a/…` (contrato); "sesión válida" es la cookie
`aq_sesion` que cumple el criterio 14. A y B son dos academias activas.

### A. Usuarios y aislamiento

1. Dadas las migraciones aplicadas, entonces existe la tabla `usuarios` del modelo de datos de esta spec, con RLS
   activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE` que comparan `academia_id` con
   `app_academia_actual()` (con la forma exacta que exige la 001, criterio 132), `UNIQUE (academia_id, id)` y
   `UNIQUE (academia_id, dni)`; y todas las pruebas de catálogo de la 001 (criterios 9 a 13, 17, 18, 124 a 126 y 131
   a 133) siguen pasando con la tabla nueva. _(crítico)_ (D-17, D-23)
2. Dado el rol `aquagestion_app`, entonces sus privilegios sobre `usuarios` son exactamente `SELECT`, `INSERT` y
   `UPDATE` de las columnas `clave_hash`, `debe_cambiar_clave`, `estado`, `version_token`, `intentos_fallidos`,
   `bloqueado_hasta`, `ultimo_acceso` y `actualizado_en`: no puede cambiar el `dni`, el `rol`, los nombres ni la
   `academia_id`, ni borrar filas. `PRIVILEGIOS_APP` y la lista de `scripts/lib/rol-app.mjs` se amplían igual, y la
   API sigue atendiendo (criterio 102 de 001). _(crítico)_ (D-23)
3. Dado un usuario con DNI `X` en A, cuando se crea otro usuario con `X` en A, entonces responde 409 `DNI_EN_USO` sin
   crear ni auditar nada; cuando se crea con `X` en B, responde 201 (D-28). Dadas dos creaciones simultáneas con el
   mismo DNI en A, exactamente una responde 201 y la otra 409, y quedan una fila y un registro de auditoría.
   _(crítico)_ (D-28, RN-03)
4. Dados usuarios en A y en B, como app: en contexto de A, `usuarios` devuelve solo los de A; un `INSERT` con
   `academia_id` de B y un `UPDATE` que cambia una fila de A a B fallan con `42501`; en contexto de plataforma o sin
   contexto, devuelve 0 filas y el `INSERT` falla. _(crítico)_ (D-23, D-29)

### B. Inicio de sesión

5. Dado un usuario activo de A, cuando envía `POST /api/a/{nombreCorto de A}/sesion` con `{ usuario: <su DNI>, clave
   }` correctos, entonces responde 200 con `RespuestaSesionAcademia` y la cabecera
   `Set-Cookie: aq_sesion=<token>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=<duración de su rol>`, con `Secure`
   cuando `NODE_ENV=production`; pone `intentos_fallidos` en 0 y `ultimo_acceso` en `RELOJ.ahora()`. El DNI se acepta
   con espacios en los extremos. Duración provisional: 12 horas para el personal y 30 días para el alumno (pregunta
   N8). _(crítico)_ (HU-05, RN-02, D-27, D-28)
6. Dada una sesión iniciada, entonces el token es un JWT HS256 firmado con `JWT_SECRETO`, con `sub` (id del
   usuario), `tipo: "academia"`, `aca` (id de su academia), `ver` (su `version_token`), `iat` y `exp = iat +
   duración`, tomados de `RELOJ`. No lleva el DNI, el nombre ni el rol. _(crítico)_ (D-25)
7. Dada una clave equivocada, un DNI que no existe en A o un DNI que existe solo en B, cuando se intenta entrar por
   A, entonces responde 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo en los tres casos y sin `Set-Cookie`. Con un
   DNI inexistente se verifica igual una clave contra el hash ficticio de 001 (mismo trabajo). _(crítico)_
8. Dado el mismo DNI en A y en B con claves distintas, cuando entra por A con la clave de B, entonces responde 401;
   con la de A, la sesión lleva `aca` igual al id de A y `GET /api/sesion` devuelve la academia A. _(crítico)_ (D-28)
9. **Bloqueo.** Dado un usuario, cuando acumula fallos seguidos, entonces los 4 primeros responden 401 y el 5.º
   responde 423 `CUENTA_BLOQUEADA` y fija `bloqueado_hasta = ahora + 15 min`. Mientras dure, todo intento, incluso con
   la clave correcta, responde 423 sin cookie ni cambio del contador. Cumplido el plazo (con `RelojFijo`), la clave
   correcta entra y deja el contador en 0; una equivocada vuelve a contar desde 1. Un ingreso correcto antes del 5.º
   fallo pone el contador en 0. Dados 10 intentos fallidos simultáneos, cada respuesta es 401 o 423, al menos una es
   423 y la cuenta queda bloqueada. Valores provisionales hasta que 003 los haga configurables (pregunta N3).
   _(crítico)_ (D-07, sección 11.4)
10. Dado un usuario `INACTIVO`, cuando entra con la clave correcta, entonces responde 403 `USUARIO_INACTIVO` sin
    cookie; con una clave equivocada responde 401 y cuenta el fallo como en el criterio 9. _(crítico)_
11. Dado un nombre corto que no existe o con formato inválido, entonces responde 404 `ACADEMIA_NO_ENCONTRADA`; dada una
    academia suspendida, 403 `ACADEMIA_SUSPENDIDA` (DR-4 de 001). En ambos casos no calcula ningún hash ni cuenta un
    intento. _(crítico)_ (D-27)
12. Dadas más de 10 peticiones `POST /api/a/{cualquier nombre corto}/sesion` en 60 segundos desde la misma IP,
    sumando todas las academias, entonces de la 11.ª en adelante responde 429 `DEMASIADAS_SOLICITUDES`, aunque la
    clave sea correcta y sin contar un intento fallido. El límite cuenta antes de leer el cuerpo y antes de buscar la
    academia (como el criterio 75 de 001). _(crítico)_
13. Dado un cuerpo que no es JSON, con campos de más, un `usuario` que tras recortar no son exactamente 8 dígitos,
    una clave vacía o de más de 128 caracteres, o caracteres de control, entonces responde 400 `SOLICITUD_INVALIDA`
    sin calcular ningún hash ni contar un intento. _(crítico)_

### C. Sesión

14. Dada una cookie `aq_sesion` válida, `GET /api/sesion` responde 200 con `RespuestaSesionAcademia`, con el rol, el
    estado y `debeCambiarClave` leídos de la base en esa petición. Responde 401 `NO_AUTENTICADO` sin cookie o con un
    token: de firma alterada; firmado con otro secreto; con `alg: none`; vencido según `RELOJ`; con `tipo` distinto de
    `academia` (también el token de una sesión de plataforma); sin `aca` o con un `aca` que no es un UUID; con `ver`
    distinto del `version_token` actual; con un `sub` que no existe; con un `sub` que existe en otra academia que la
    de `aca`; o de un usuario `INACTIVO`. También responde 401 si el token llega en `Authorization: Bearer` en lugar de
    la cookie. _(crítico)_
15. Dada una sesión válida de un usuario de A, cuando el Superadmin suspende A, entonces toda ruta de academia
    responde 403 `ACADEMIA_SUSPENDIDA` sin ejecutar nada (DR-4 de 001). Cuando la reactiva, las sesiones aún no
    vencidas vuelven a funcionar (riesgo aceptado; pregunta T2). _(crítico)_
16. Dada una sesión válida, cuando la cuenta se desactiva (criterio 31) o su contraseña se restablece (criterios 35 y
    40), entonces esa sesión responde 401 en la siguiente petición. _(crítico)_
17. Dada una sesión válida, cuando se envía `DELETE /api/sesion`, entonces responde 204, borra la cookie (`aq_sesion=`
    con `Max-Age=0` y `Path=/api`) e incrementa `version_token`: esa cookie y cualquier otra sesión de la misma cuenta
    dejan de valer (401). Sin sesión válida, o con la academia suspendida, también responde 204 y borra la cookie, sin
    cambiar nada más (pregunta N8). _(crítico)_
18. Dada cualquier ruta de academia distinta de `DELETE /api/sesion`, incluidas las que no existen y las que llevan
    barra final, cuando se pide sin sesión válida, entonces responde 401 `NO_AUTENTICADO` sin ejecutar nada y antes de
    leer el cuerpo; con sesión válida, una ruta inexistente responde 404 `NO_ENCONTRADO`. Toda respuesta de una ruta de
    academia, también las de error, lleva `Cache-Control: no-store`. _(crítico)_
19. Dada una cookie `aq_sesion` válida, cuando se pide una ruta de `/api/plataforma/…`, entonces responde 401 (solo
    vale `aq_plataforma`); dada una cookie `aq_plataforma` válida, o su token puesto en `aq_sesion`, cuando se pide una
    ruta de academia, entonces responde 401. _(crítico)_ (D-29)
20. Dado un usuario de A con sesión válida, entonces toda operación corre con `conAcademia(<aca de su sesión>, …)`:
    ninguna ruta de academia recibe una academia (id ni nombre corto) en la dirección, la consulta o el cuerpo, y un
    cuerpo con un campo `academiaId` responde 400 (esquemas estrictos). Prueba: con sesión de A, pedir con ids de
    usuarios de B responde 404 y no cambia nada en B. _(crítico; prueba y verificación del revisor)_ (D-23; riesgo
    "RLS no protege de un error dentro de la academia correcta" de 001)

### D. Cambio de contraseña

21. Dado un usuario con `debe_cambiar_clave = true` y sesión válida, cuando pide cualquier ruta de academia salvo
    `GET /api/sesion`, `DELETE /api/sesion` y `POST /api/sesion/clave`, entonces responde 403
    `CAMBIO_DE_CLAVE_OBLIGATORIO` sin ejecutar nada. _(crítico)_ (RN-02, RNF-04, HU-05)
22. Dada una sesión válida, cuando se envía `POST /api/sesion/clave` con `{ claveActual, claveNueva }` correctos,
    entonces responde 200 con `RespuestaSesionAcademia` (`debeCambiarClave: false`) y una cookie `aq_sesion` nueva;
    guarda el hash argon2id de la nueva (empieza por `$argon2id$`), pone `debe_cambiar_clave` en `false`, incrementa
    `version_token` (la cookie anterior y las demás sesiones de la cuenta dejan de valer) y registra
    `USUARIO_CLAVE_CAMBIADA`. Vale para todos los roles, también el alumno (D-14). _(crítico)_ (HU-05)
23. Dada una `claveNueva` de menos de 8 o más de 128 caracteres (puntos de código), con caracteres de control, igual
    al DNI del usuario o igual a la clave actual, entonces responde 400 `SOLICITUD_INVALIDA` con
    `detalles.errores[].campo` igual a `claveNueva`, sin cambiar nada. Mínimo provisional: 8 (pregunta N2).
    _(crítico)_ (RNF-04)
24. Dada una `claveActual` equivocada, entonces responde 400 `CLAVE_ACTUAL_INCORRECTA` y cuenta un intento fallido con
    las reglas del criterio 9 (el 5.º responde 423 y bloquea); con la cuenta bloqueada responde 423 sin verificar la
    clave. La sesión sigue valiendo. _(crítico)_
25. Dados dos cambios simultáneos con la misma `claveActual` correcta y claves nuevas distintas, entonces uno responde
    200 y el otro 400 `CLAVE_ACTUAL_INCORRECTA` o 401, y la clave que queda es la del que respondió 200. _(crítico)_

### E. Permisos

26. Dado `packages/contratos/src/permisos.ts`, entonces `MATRIZ_PERMISOS` tiene exactamente las filas, roles y
    alcances de la tabla "Matriz de permisos" del contrato (las 21 filas de la sección 2.1 más las 2 de esta
    historia), y una prueba unitaria la compara fila por fila. _(crítico)_ (sección 2.1)
27. Dado el backend, entonces cada manejador de una ruta de academia declara un permiso de la matriz
    (`@Permiso(...)`) o que basta con la sesión (`@SoloSesion()`). Uno sin declaración responde 403 `SIN_PERMISO` a
    cualquier rol (falla cerrada). Una prueba recorre todas las rutas registradas en la aplicación y falla si una ruta
    de academia no tiene declaración. _(crítico)_ (RNF-03)
28. Dado un rol que la matriz no permite para una ruta, cuando la pide con sesión válida, entonces responde 403
    `SIN_PERMISO` sin escribir nada ni auditar. Prueba: cada ruta de esta historia con cada uno de los cuatro roles.
    _(crítico)_ (sección 2.1)

### F. Gestión del personal (administrador)

29. Dado un `ADMIN` de A, `GET /api/usuarios` responde 200 con `{ usuarios: UsuarioResumen[] }`: el personal de A
    (sin alumnos), ordenado por apellidos y nombres; nunca usuarios de B ni el hash, la versión de token o el contador
    de intentos. _(crítico)_ (sección 8.7)
30. Dado un `ADMIN` de A, cuando envía `POST /api/usuarios` con `{ dni, nombres, apellidos, rol }` válidos y `rol`
    `ADMIN`, `SECRETARIA` o `ENTRENADOR`, entonces responde 201 con `{ usuario: UsuarioResumen }`; el usuario queda en
    A, `ACTIVO`, con `clave_hash` argon2id de su DNI y `debe_cambiar_clave = true` (pregunta N1), y se registra
    `USUARIO_CREADO`. Con `rol` `ALUMNO` responde 400: las cuentas de alumno las crea el paso de cliente a alumno
    (HU-04, historia 007). _(crítico)_ (RN-02, D-28)
31. Dado un `ADMIN` de A y un miembro del personal de A activo que no es él, cuando envía
    `POST /api/usuarios/{id}/desactivar`, entonces responde 200 con el usuario `INACTIVO`, incrementa su
    `version_token` y registra `USUARIO_DESACTIVADO`. Sobre sí mismo responde 409 `OPERACION_SOBRE_SI_MISMO`; sobre uno
    ya inactivo, 409 `USUARIO_YA_INACTIVO`; sobre un alumno, 404 `NO_ENCONTRADO` (su estado lo maneja la historia
    010). Pregunta N6. _(crítico)_
32. Dado un miembro del personal inactivo, cuando el `ADMIN` envía `POST /api/usuarios/{id}/reactivar`, entonces
    responde 200 con el usuario `ACTIVO` y registra `USUARIO_REACTIVADO`; sobre uno activo, 409 `USUARIO_YA_ACTIVO`.
    Reactivar no cambia la contraseña. _(crítico)_
33. Dado un `{id}` que no es un UUID, que no existe o que es de otra academia, entonces desactivar, reactivar y
    restablecer responden 404 `NO_ENCONTRADO` con el mismo cuerpo, sin cambios ni auditoría. _(crítico)_ (D-23)

### G. Restablecimiento de la contraseña (HU-05)

34. Dado un `ADMIN` o una `SECRETARIA` de A, `GET /api/usuarios/por-dni/{dni}` responde 200 con
    `{ usuario: UsuarioResumen }` si el DNI es de un usuario de A que quien pide puede restablecer (criterio 36); si
    no existe, es de otra academia, está fuera de su alcance o el DNI no tiene el formato, 404 `NO_ENCONTRADO` con el
    mismo cuerpo. _(crítico)_
35. Dado un usuario de A dentro del alcance de quien pide, cuando se envía `POST /api/usuarios/{id}/restablecer-clave`,
    entonces responde 200 con `{ usuario: UsuarioResumen }`; la clave vuelve a ser su DNI (hash argon2id nuevo),
    `debe_cambiar_clave` queda en `true`, `intentos_fallidos` en 0, `bloqueado_hasta` en nulo (desbloquea) y
    `version_token` sube; se registra `USUARIO_CLAVE_RESTABLECIDA`. Después, el usuario entra con su DNI y se le exige
    el cambio (criterio 21). No reactiva una cuenta inactiva. _(crítico)_ (HU-05, RN-02)
36. **Alcance** (provisional, pregunta N4): la `SECRETARIA` solo restablece a alumnos (sobre otro rol, 404); el
    `ADMIN` restablece a cualquier usuario de A salvo a sí mismo (409 `OPERACION_SOBRE_SI_MISMO`). _(crítico)_
37. Dado un `ENTRENADOR` o un `ALUMNO`, cuando pide cualquiera de las rutas de los criterios 29 a 35, entonces responde
    403 `SIN_PERMISO` (criterio 28). _(crítico)_

### H. Superadmin y administradores de cada academia (DR-1, D-29)

38. Dada una sesión de superadmin, `GET /api/plataforma/academias/{id}/administradores` responde 200 con
    `{ administradores: AdministradorResumen[] }`: solo los usuarios con rol `ADMIN` de esa academia, con los campos del
    esquema estricto; nunca otros roles ni otros campos. _(crítico)_ (D-29; pregunta N5)
39. Dada una sesión de superadmin y una academia activa, cuando envía
    `POST /api/plataforma/academias/{id}/administradores` con `{ dni, nombres, apellidos }` válidos, entonces responde
    201 con `{ administrador: AdministradorResumen }`; el usuario queda en esa academia con rol `ADMIN`, `ACTIVO`, clave
    igual a su DNI y `debe_cambiar_clave = true`; se registra `USUARIO_CREADO` en la auditoría **de esa academia**, con
    actor `SUPERADMIN` y su id. Si el DNI ya existe en esa academia, con cualquier rol, responde 409 `DNI_EN_USO`. Sirve
    para el primero y para los siguientes. _(crítico)_ (DR-1, D-29)
40. Dada una sesión de superadmin, cuando envía
    `POST /api/plataforma/academias/{id}/administradores/{usuarioId}/restablecer-clave`, entonces hace lo del criterio
    35 con actor `SUPERADMIN`. Un `usuarioId` de otro rol, de otra academia, inexistente o que no es un UUID responde
    404 `NO_ENCONTRADO`. _(crítico)_ (pregunta N5)
41. En las tres rutas de la plataforma: una academia suspendida responde 403 `ACADEMIA_SUSPENDIDA`; un `{id}` que no es
    un UUID o no existe, 404 `ACADEMIA_NO_ENCONTRADA`; sin sesión de superadmin (también con una cookie `aq_sesion` de
    un administrador), 401 `NO_AUTENTICADO`. _(crítico)_

### I. Auditoría y registro técnico

42. Dadas las operaciones de esta historia, entonces quedan en `auditoria` de la academia afectada, con `entidad`
    `usuario`, `entidad_id` (id del usuario), actor (`USUARIO` o `SUPERADMIN` y su id) e `ip`:
    - `USUARIO_CREADO`: `datosDespues` con `id`, `dni`, `nombres`, `apellidos`, `rol` y `estado`;
    - `USUARIO_DESACTIVADO` y `USUARIO_REACTIVADO`: `datosAntes` y `datosDespues` con `estado`;
    - `USUARIO_CLAVE_RESTABLECIDA` y `USUARIO_CLAVE_CAMBIADA`: sin datos de la clave.

    Ninguno contiene la contraseña ni un hash. Si la inserción de auditoría falla, la operación completa falla y no
    deja nada (criterio 30 de 001). Los inicios y cierres de sesión no se auditan (como DR-7 de 001; pregunta N9).
    _(crítico)_ (RN-22, RNF-06)
43. Dados inicios de sesión correctos, fallidos, bloqueados y con academia inexistente, cambios y restablecimientos de
    contraseña, entonces el registro técnico (pino) anota el resultado con el id del usuario (si existe), el id de la
    academia y la IP, y nunca contiene, en ningún nivel, la clave, la clave nueva, la clave actual, el token ni el
    `usuario` (DNI) escrito en el formulario. _(crítico)_ (Ley 29733, RNF-05; criterios 46 y 162 de 001)

### J. Esquemas, semilla, web y documentación

44. Dados los esquemas compartidos (`sesion.ts`, `usuarios.ts`, `permisos.ts`), entonces validan lo que dice el
    contrato: DNI de exactamente 8 dígitos tras recortar; `nombres` y `apellidos` recortados, de 2 a 100 caracteres
    visibles y sin caracteres de control (como los textos de 001); claves según los criterios 13 y 23. _(prueba
    obligatoria, unitaria)_
45. Dado `NODE_ENV` distinto de `production`, cuando se ejecuta `npm run db:semilla`, entonces crea, si no existen, un
    usuario por rol en `delfines` y un administrador en `tiburones` con el mismo DNI que el de `delfines` (D-28), con
    DNIs inventados, clave igual al DNI y `debe_cambiar_clave = true`; repetirla no duplica ni restablece claves. La
    salida no muestra claves. _(prueba obligatoria)_
46. Dada `/a/{nombreCorto}/ingresar`, entonces muestra el nombre de la academia (de `GET /api/a/{nombreCorto}`) y un
    formulario de DNI y contraseña; con éxito lleva a `/cambiar-clave` si `debeCambiarClave` y si no a `/panel`;
    muestra los mensajes de 401, 423, 429, 403 `USUARIO_INACTIVO`, academia suspendida ("Academia no disponible por el
    momento", DR-4) y academia inexistente; incluye "¿Olvidaste tu contraseña? Pide en recepción que la restablezcan."
    (textos orientativos). No guarda nada de la sesión en `localStorage` ni en `sessionStorage`. _(prueba
    obligatoria)_
47. Dada `/cambiar-clave`, entonces pide la contraseña actual, la nueva y su confirmación, valida con el esquema
    compartido y muestra los errores de los criterios 23 y 24; en el cambio obligatorio no deja ir a otra página hasta
    terminar (salvo cerrar sesión); al terminar lleva a `/panel`. _(prueba obligatoria)_
48. Dada `/panel` con sesión, entonces muestra el nombre del usuario, su rol, su academia, "Cambiar contraseña" y
    "Cerrar sesión", y solo las opciones que su rol permite según `MATRIZ_PERMISOS` (en esta historia: "Usuarios" para
    el administrador y "Restablecer contraseña" para el administrador y la secretaria). Sin sesión lleva a una página que
    pide entrar por el enlace de su academia; con 403 `ACADEMIA_SUSPENDIDA` muestra "Academia no disponible por el
    momento". Se ve completa a 360 px (RNF-01). _(prueba obligatoria)_
49. Dada `/panel/usuarios` (administrador), entonces lista el personal (nombre, DNI, rol, estado, "bloqueado" y último
    acceso en America/Lima, `dd/MM/yyyy HH:mm`), crea usuarios mostrando el 409 junto al DNI, y desactiva, reactiva y
    restablece con confirmación. Dada `/panel/restablecer` (administrador y secretaria), busca por DNI, muestra el
    nombre y restablece con confirmación, explicando que la nueva contraseña es el DNI. _(prueba obligatoria de los
    estados principales)_
50. Dada `/plataforma/academias`, entonces cada academia tiene "Administradores", que muestra su lista, crea uno
    (con el 409 junto al DNI) y restablece la contraseña de uno con confirmación. _(prueba obligatoria)_
51. Dado `npm run e2e`, entonces una prueba de Playwright: el superadmin crea una academia y su administrador; el
    administrador entra por `/a/{nombreCorto}/ingresar` con su DNI, cambia la contraseña obligatoriamente, crea una
    secretaria y cierra sesión; la secretaria entra y se le exige el cambio. _(CI en Linux)_
52. Dada `docs/guia-local-windows.md`, entonces explica cómo entrar como usuario de una academia con los usuarios de la
    semilla (`http://localhost:5173/a/delfines/ingresar`) y que la primera vez se pide cambiar la contraseña.
    _(verificación manual del responsable; lo escribe el documentador)_

## Casos límite

- **DNI con ceros a la izquierda (`01234567`):** es texto, no número; se guarda y se compara tal cual.
- **DNI escrito con espacios o con un guion:** se recortan los espacios de los extremos; un guion o un espacio en
  medio no cumple el formato (400 en el ingreso y al crear).
- **La misma persona en dos academias (D-28):** dos cuentas independientes, con claves, bloqueos y sesiones propios.
  Bloquear la de A no afecta a la de B.
- **Una sola sesión de academia por navegador:** la cookie `aq_sesion` es una; entrar a B reemplaza la sesión de A
  (pregunta T3). La web de `/a/A/…` con una sesión de B muestra los datos de B, porque la academia sale de la sesión.
- **Superadmin y usuario de academia en el mismo navegador:** cookies distintas con rutas distintas; ninguna vale en
  las rutas de la otra (criterio 19).
- **Restablecer a un usuario bloqueado:** lo desbloquea (criterio 35).
- **Restablecer o desactivar dos veces seguidas (doble clic):** restablecer dos veces deja el mismo resultado con dos
  registros de auditoría; desactivar dos veces responde 200 y 409.
- **Cambio obligatorio con la contraseña actual igual al DNI:** la nueva no puede ser el DNI (criterio 23).
- **Contraseña con tildes, eñes o emojis:** se acepta; la longitud se cuenta por puntos de código y no se normaliza
  (se compara exactamente lo que se escribió).
- **Sesión abierta y cuenta bloqueada por fallos de otra persona:** la sesión sigue valiendo (como en 001); el
  bloqueo solo impide nuevos ingresos.
- **Dos administradores se desactivan entre sí a la vez:** la academia puede quedar sin administrador activo; el
  Superadmin crea otro (criterio 39). Se acepta.
- **Academia suspendida mientras un usuario cambia su contraseña:** la operación ya iniciada termina (riesgo aceptado
  en 001); la siguiente petición responde 403.
- **Hora del servidor en otra zona:** el vencimiento del token y del bloqueo se calculan con `RELOJ` sobre instantes;
  la web muestra el último acceso en America/Lima.

## Reglas de negocio aplicables

- **RN-02 y HU-05:** el usuario es el DNI y la contraseña inicial también; cambio obligatorio en el primer ingreso; el
  usuario puede cambiarla cuando quiera; la secretaria la restablece al DNI.
- **RN-03 ajustada por D-28:** el DNI es único dentro de cada academia.
- **RN-29, D-14:** padres y alumno usan la misma cuenta; en esa cuenta solo se puede cambiar la contraseña.
- **RNF-03 y RNF-04:** argon2, control de acceso por roles y cambio obligatorio.
- **Sección 2.1:** matriz de permisos. **Sección 8.7:** el administrador gestiona usuarios.
- **Sección 11.4:** contraseña igual al DNI mitigada con el cambio obligatorio y el bloqueo; la secretaria restablece
  la contraseña de la cuenta compartida.
- **D-07:** `intentos_fallidos`, `bloqueado_hasta` y `ultimo_acceso`; máximo de intentos y tiempo de bloqueo en la
  configuración (la clave la define 003; aquí, valores provisionales).
- **D-23, D-27, D-28, D-29 y DR-1, DR-4 y DR-7 de 001.**
- **Reglas que no se negocian de `CLAUDE.md`:** `academia_id` en la tabla nueva; auditoría de los cambios de cuentas;
  efectos secundarios después de confirmar (esta historia no tiene ninguno: no envía correos, D-19).
- **Reglas para las historias siguientes de `docs/arquitectura.md`:** cada paso de una transacción con `await`;
  duplicados con `INSERT … ON CONFLICT DO NOTHING RETURNING`; errores de la base con `errorParaRegistro`; sin cachés de
  datos en propiedades de los servicios (salvo por petición, con `WeakMap`, como la sesión de plataforma).

## Contrato

### Rutas

Todas las respuestas de las rutas de academia, de `/api/a/…` y de `/api/plataforma/…` llevan `Cache-Control:
no-store`. Los cuerpos son JSON y los esquemas, estrictos (un campo de más es 400), con las reglas de cuerpos de 001
(criterios 74, 89 y 105). Las pruebas comprueban el código y el estado, no el texto del mensaje.

| Método y ruta | Sesión | Permiso | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- | --- |
| `POST /api/a/{nombreCorto}/sesion` | no | — | `iniciarSesionAcademiaSchema` | 200 `RespuestaSesionAcademia` + cookie | 400, 401 `CREDENCIALES_INVALIDAS`, 403 `USUARIO_INACTIVO` / `ACADEMIA_SUSPENDIDA`, 404 `ACADEMIA_NO_ENCONTRADA`, 423, 429 |
| `GET /api/sesion` | sí | `@SoloSesion` | — | 200 `RespuestaSesionAcademia` | 401, 403 `ACADEMIA_SUSPENDIDA` |
| `DELETE /api/sesion` | no | — | — | 204, borra la cookie | — |
| `POST /api/sesion/clave` | sí | `@SoloSesion` | `cambiarClaveSchema` | 200 `RespuestaSesionAcademia` + cookie nueva | 400 `SOLICITUD_INVALIDA` / `CLAVE_ACTUAL_INCORRECTA`, 401, 423 |
| `GET /api/usuarios` | sí | `GESTIONAR_USUARIOS` | — | 200 `{ usuarios }` | 401, 403 |
| `POST /api/usuarios` | sí | `GESTIONAR_USUARIOS` | `crearUsuarioSchema` | 201 `{ usuario }` | 400, 401, 403, 409 `DNI_EN_USO` |
| `POST /api/usuarios/{id}/desactivar` | sí | `GESTIONAR_USUARIOS` | `{}` | 200 `{ usuario }` | 401, 403, 404, 409 `OPERACION_SOBRE_SI_MISMO` / `USUARIO_YA_INACTIVO` |
| `POST /api/usuarios/{id}/reactivar` | sí | `GESTIONAR_USUARIOS` | `{}` | 200 `{ usuario }` | 401, 403, 404, 409 `USUARIO_YA_ACTIVO` |
| `GET /api/usuarios/por-dni/{dni}` | sí | `RESTABLECER_CLAVE` | — | 200 `{ usuario }` | 401, 403, 404 |
| `POST /api/usuarios/{id}/restablecer-clave` | sí | `RESTABLECER_CLAVE` | `{}` | 200 `{ usuario }` | 401, 403, 404, 409 `OPERACION_SOBRE_SI_MISMO` |
| `GET /api/plataforma/academias/{id}/administradores` | superadmin | — | — | 200 `{ administradores }` | 401, 403, 404 |
| `POST /api/plataforma/academias/{id}/administradores` | superadmin | — | `crearAdministradorSchema` | 201 `{ administrador }` | 400, 401, 403, 404, 409 `DNI_EN_USO` |
| `POST /api/plataforma/academias/{id}/administradores/{usuarioId}/restablecer-clave` | superadmin | — | `{}` | 200 `{ administrador }` | 401, 403, 404 |

Además, con `debe_cambiar_clave = true`, toda ruta de academia salvo `GET` y `DELETE /api/sesion` y
`POST /api/sesion/clave` responde 403 `CAMBIO_DE_CLAVE_OBLIGATORIO` (criterio 21). Orden de las comprobaciones en una
ruta de academia: sesión (401) → academia activa (403 `ACADEMIA_SUSPENDIDA`) → cambio obligatorio (403) → permiso
(403 `SIN_PERMISO`) → validación del cuerpo (400) → operación.

**Rutas de academia:** todo `/api/*` salvo `/api/salud`, `/api/plataforma/…` y `/api/a/…`. La exigencia de sesión se
aplica con un middleware de todo el prefijo, antes del lector del cuerpo (como P-7 de 001), no por controlador.

### Cookie y token

- Cookie `aq_sesion`: `HttpOnly`, `SameSite=Strict`, `Path=/api`, `Max-Age` igual a la duración del rol, `Secure` con
  `NODE_ENV=production`. Borrado: `aq_sesion=` con `Max-Age=0` y `Path=/api`.
- Token: criterio 6. Duración provisional (pregunta N8): `ADMIN`, `SECRETARIA` y `ENTRENADOR` 43 200 s (12 h);
  `ALUMNO` 2 592 000 s (30 días).
- La sesión se verifica en cada petición con una consulta dentro de `conAcademia(aca, …)`: el usuario `sub` existe en
  esa academia, está `ACTIVO` (si no, 401) y su `version_token` es `ver`. El rol y `debe_cambiar_clave` salen de esa
  fila, no del token.
- Límite por IP del inicio de sesión: 10 peticiones por IP cada 60 s, una sola cuenta para todas las academias
  (pregunta T1). Bloqueo: 5 fallos seguidos, 15 minutos (pregunta N3).

### Esquemas compartidos (`packages/contratos/src/`)

- `sesion.ts`:
  - `dniSchema`: texto recortado de exactamente 8 dígitos (`^[0-9]{8}$`).
  - `iniciarSesionAcademiaSchema`: `{ usuario: dniSchema; clave: 1 a 128, sin controles }`.
  - `claveNuevaSchema`: 8 a 128 puntos de código, sin controles (sin recortar).
  - `cambiarClaveSchema`: `{ claveActual: 1 a 128; claveNueva: claveNuevaSchema }`.
  - `rolUsuarioSchema`: `'ADMIN' | 'SECRETARIA' | 'ENTRENADOR' | 'ALUMNO'`.
  - `usuarioSesionSchema` (estricto): `{ id: uuid; nombres; apellidos; rol; debeCambiarClave: boolean; academia: {
    nombreCorto; nombre } }`. `respuestaSesionAcademiaSchema`: `{ usuario: usuarioSesionSchema }`.
- `usuarios.ts`:
  - `rolPersonalSchema`: `'ADMIN' | 'SECRETARIA' | 'ENTRENADOR'`.
  - `crearUsuarioSchema`: `{ dni: dniSchema; nombres; apellidos; rol: rolPersonalSchema }`.
  - `crearAdministradorSchema`: `{ dni; nombres; apellidos }`.
  - `usuarioResumenSchema` (estricto): `{ id; dni; nombres; apellidos; rol; estado: 'ACTIVO' | 'INACTIVO';
    debeCambiarClave; bloqueado: boolean; ultimoAcceso: ISO 8601 UTC | null }`. `bloqueado` es `bloqueado_hasta >
    ahora` según `RELOJ`.
  - `administradorResumenSchema` (estricto): `usuarioResumenSchema` sin `rol` ni `ultimoAcceso`.
- `permisos.ts`: `ROLES_USUARIO`, `ALCANCES`, `PERMISOS` y `MATRIZ_PERMISOS: Record<Permiso, Partial<Record<RolUsuario,
  Alcance>>>`, y `puede(rol, permiso): boolean`.

### Matriz de permisos

Alcances: `TODO`; `SUS_ALUMNOS` ("solo los suyos"); `SUS_CLASES`; `PROPIO` ("propia", "solo los suyos" del alumno, sus
propios pagos); `SU_CAJA` ("parcial: su caja"); `LOS_QUE_SUBE`; `ALUMNOS` (solo cuentas de alumno). Una celda vacía
es "no". El guard de esta historia solo decide si el rol pasa; cada historia aplica el alcance en su servicio.

| Permiso | Fila de la sección 2.1 | ADMIN | SECRETARIA | ENTRENADOR | ALUMNO |
| --- | --- | --- | --- | --- | --- |
| `CONFIGURAR_PLANES_HORARIOS_AFORO` | Configurar planes, horarios y aforo | `TODO` | | | |
| `CREAR_CODIGOS_DESCUENTO` | Crear códigos de descuento | `TODO` | | | |
| `AUTORIZAR_CLASES_PARTICULARES` | Autorizar clases particulares | `TODO` | | | |
| `COBRAR_CLASE_PARTICULAR` | Cobrar clase particular autorizada | `TODO` | `TODO` | | |
| `REGISTRAR_INSCRIPCION_Y_COBRO` | Registrar inscripción y cobro | `TODO` | `TODO` | | |
| `VERIFICAR_PAGOS` | Verificar pagos (Yape o transferencia) | `TODO` | `TODO` | | |
| `ABRIR_CERRAR_CAJA` | Abrir y cerrar caja | `TODO` | `TODO` | | |
| `REGISTRAR_ASISTENCIA` | Registrar asistencia (QR o manual) | `TODO` | `TODO` | | |
| `MODIFICAR_HORARIO_ALUMNO` | Modificar el horario de un alumno a mitad de mes | `TODO` | `TODO` | | |
| `VER_FICHA_ALUMNO` | Ver la ficha de sus alumnos | `TODO` | `TODO` | `SUS_ALUMNOS` | |
| `EDITAR_RENDIMIENTO` | Editar el rendimiento del alumno | | | `SUS_ALUMNOS` (RN-18) | |
| `SUBIR_MULTIMEDIA` | Subir fotos y videos | `TODO` | | `SUS_ALUMNOS` (`CLAUDE.md`: el entrenador solo ve a sus alumnos) | |
| `VER_REPORTES_FINANCIEROS` | Ver reportes financieros | `TODO` | `SU_CAJA` | | |
| `VER_REPORTES_ASISTENCIA` | Ver reportes de asistencia | `TODO` | `TODO` | `SUS_CLASES` | `PROPIO` |
| `VER_CARNET` | Ver carnet digital y QR | `TODO` | `TODO` | | `PROPIO` (D-14) |
| `AUTORIZAR_ASISTENCIA_OTRO_HORARIO` | Autorizar asistencia en otro horario | `TODO` | `TODO` | | |
| `REGISTRAR_PAGOS_ENTRENADORES` | Registrar pagos a entrenadores | `TODO` | | | |
| `VER_PAGOS_RECIBIDOS` | Ver sus pagos recibidos | | | `PROPIO` | |
| `REGISTRAR_DIAS_CIERRE` | Registrar días de cierre y fechas de recuperación | `TODO` | | | |
| `EMITIR_CERTIFICADOS` | Emitir certificados | `TODO` | | | |
| `VER_MULTIMEDIA` | Ver fotos y videos del alumno | `TODO` | | `LOS_QUE_SUBE` | `PROPIO` |
| `GESTIONAR_USUARIOS` | (sección 8.7: "usuarios") | `TODO` | | | |
| `RESTABLECER_CLAVE` | (HU-05; alcance, pregunta N4) | `TODO` (no a sí mismo) | `ALUMNOS` | | |

La columna "Cliente" de la sección 2.1 no es un rol con cuenta: su único permiso (autoinscripción) es la ruta pública
de la historia 005. Cambiar la propia contraseña no es una fila: basta la sesión (`@SoloSesion`, D-14).

### Servicios del backend (para las historias siguientes)

```ts
// backend/src/modulos/autenticacion/index.ts
interface UsuarioAutenticado { readonly id: string; readonly academiaId: string; readonly rol: RolUsuario;
  readonly nombres: string; readonly apellidos: string; readonly debeCambiarClave: boolean }
function Permiso(permiso: PermisoMatriz): MethodDecorator & ClassDecorator;
function SoloSesion(): MethodDecorator & ClassDecorator;
const UsuarioActual: ParameterDecorator; // el UsuarioAutenticado de la petición

// backend/src/modulos/usuarios/index.ts — la historia 007 lo usa para crear la cuenta del alumno (HU-04)
class UsuariosService {
  crearEnTransaccion(tx: TransaccionAcademia, datos: { dni: string; nombres: string; apellidos: string;
    rol: RolUsuario; claveHash: string }, actor: { tipo: 'USUARIO' | 'SUPERADMIN' | 'SISTEMA'; id: string | null },
    ip: string | null): Promise<UsuarioResumen>; // 409 DNI_EN_USO; audita USUARIO_CREADO en la misma transacción
}
```

`claveHash` se calcula fuera de la transacción (argon2 tarda decenas de milisegundos).

### Códigos de error nuevos

`USUARIO_INACTIVO` (403), `SIN_PERMISO` (403), `CAMBIO_DE_CLAVE_OBLIGATORIO` (403), `CLAVE_ACTUAL_INCORRECTA` (400),
`DNI_EN_USO` (409), `OPERACION_SOBRE_SI_MISMO` (409), `USUARIO_YA_INACTIVO` (409), `USUARIO_YA_ACTIVO` (409). Se
reutilizan los de 000 y 001.

### Utilidades de prueba (`backend/test/utilidades/usuarios.ts`)

Las escribe el test-writer con las pruebas protegidas y llevan la misma marca:

```ts
export function crearUsuarioDePrueba(datos: { academiaId: string; rol: RolUsuario; dni?: string; clave?: string;
  nombres?: string; apellidos?: string; debeCambiarClave?: boolean; estado?: 'ACTIVO' | 'INACTIVO' }):
  Promise<{ id: string; dni: string; clave: string; academiaId: string; rol: RolUsuario }>; // por defecto, clave = DNI
export function iniciarSesionAcademia(app: INestApplication, nombreCorto: string,
  credenciales: { usuario: string; clave: string }): Promise<string>; // valor para la cabecera Cookie
export function firmarTokenAcademia(claims: Record<string, unknown>,
  opciones?: { secreto?: string; algoritmo?: 'HS256' | 'none' }): string;
```

### Eventos

Ninguno.

## Cambios al modelo de datos

Una migración `<marca>_usuarios`. Ajusta la entidad `USUARIO` de la sección 9.1: `username` pasa a `dni`,
`password_hash` a `clave_hash` y `debe_cambiar_password` a `debe_cambiar_clave`; se agregan `academia_id` (D-23),
`nombres` y `apellidos` (el personal no tiene otra tabla con su nombre) y los campos de D-07.

- **`usuarios`** (por academia): `id uuid` PK (`gen_random_uuid()`); `academia_id uuid not null` → `academias(id)`
  (`RESTRICT`); `dni text not null` con `CHECK (dni ~ '^[0-9]{8}$')`; `nombres text not null`; `apellidos text not
  null`; `rol rol_usuario not null` (`ADMIN`, `SECRETARIA`, `ENTRENADOR`, `ALUMNO`); `clave_hash text not null`;
  `debe_cambiar_clave boolean not null default true`; `estado estado_usuario not null default 'ACTIVO'` (`ACTIVO`,
  `INACTIVO`); `version_token integer not null default 0`; `intentos_fallidos integer not null default 0`;
  `bloqueado_hasta timestamptz null`; `ultimo_acceso timestamptz null`; `creado_en`, `actualizado_en`.
  `UNIQUE (academia_id, id)`, `UNIQUE (academia_id, dni)`; índice `(academia_id, rol, apellidos, nombres)`.
- **RLS** activada y forzada; políticas de `SELECT`, `INSERT` y `UPDATE` con `academia_id = app_academia_actual()`
  (forma exacta del criterio 132 de 001). Sin política ni privilegio de `DELETE`.
- **Privilegios** de `aquagestion_app`: criterio 2.
- `auditoria.actor_id` sigue sin llave foránea (el actor puede ser un superadmin).

## Fuera de alcance

- **Crear cuentas de alumno:** las crea el paso de cliente a alumno (HU-04, 007), con `UsuariosService.crearEnTransaccion`.
- **Datos propios del entrenador** (teléfono, especialidad, asignación a clases): 004 y 012.
- **Cambiar el DNI, el nombre o el rol de una cuenta, y borrar cuentas:** no en esta historia (el rol de la app no
  tiene ese privilegio).
- **Estados del alumno** (activo, vencido, inactivo) y su efecto en el acceso: 010.
- **Configurar los intentos y el tiempo de bloqueo:** 003 (D-07); aquí van como constantes.
- **Recuperar la contraseña por correo:** no hay proveedor (D-19); la secretaria la restablece (HU-05).
- **Ver la auditoría por pantalla:** Fase 3.
- **Panel del alumno, del entrenador y de recepción con contenido:** 008, 011, 012 y las historias de cada módulo;
  aquí `/panel` es solo el inicio con el menú según el rol.
- **Límite de peticiones de `GET /api/a/{nombreCorto}`:** sigue en la nota de 005 del backlog.
- **`trust proxy` y límites del proveedor:** con el hosting (D-21).

## Impacto en especificaciones anteriores

- **001, criterio 2 y `PRIVILEGIOS_APP`:** la lista exacta de privilegios suma los de `usuarios` (criterio 2 de esta
  spec). La prueba protegida de 001 que compara la lista exacta la actualiza el test-writer en el commit de pruebas
  protegidas de 002, sin quitar nada de lo que comprueba; `scripts/lib/rol-app.mjs` se amplía igual.
- **001, P-7 y P-8 (`instalarProteccionDePrefijos`):** se agregan el middleware de las rutas de academia (criterio 18)
  y el límite por IP de `POST /api/a/{nombreCorto}/sesion` en el middleware de `/api/a` (criterio 12). Las rutas y
  respuestas de 001 no cambian.
- **001, `ClaimsSesion` y `verificarToken`:** se agrega el claim opcional `aca`. La sesión de plataforma no cambia
  (sigue exigiendo `tipo: "plataforma"`).
- **001, `REGLAS_BLOQUEO_SUPERADMIN` y `evaluarIntentoFallido`:** se reutilizan con `REGLAS_BLOQUEO_USUARIO`; el
  archivo no se mueve, para no tocar sus pruebas protegidas.
- **001, riesgo "RLS no protege de un error dentro de la academia correcta":** lo cierra el criterio 20.
- **001, notas de 002 (sección "Impacto"):** el Superadmin no opera sobre academias suspendidas, así que
  `conAcademia` no cambia (criterio 41).
- **001, DR-1 y D-29:** el primer administrador lo crea esta historia (criterio 39).
- **001, `crearDatosDeAislamiento` y `limpiarBase`:** no cambian; `limpiarBase` ya vacía toda tabla de `public`.

## Riesgos aceptados

- **Cuenta nueva con la clave igual al DNI:** quien conozca el DNI y la academia puede entrar antes que el dueño y
  cambiar la contraseña. Es propio de RN-02. Lo mitigan el límite por IP, el bloqueo y que el dueño, al no poder
  entrar, pide el restablecimiento en recepción.
- **Bloqueo provocado por terceros:** un compañero que conoce el DNI puede bloquear la cuenta 15 minutos. Es temporal y
  el restablecimiento lo levanta al instante (criterio 35).
- **Saber si un DNI tiene cuenta en una academia:** el 423 solo aparece para DNIs con cuenta, y `USUARIO_INACTIVO` solo
  con la clave correcta. Se acepta como en 001 (correo del superadmin): exige varios intentos y lo limita la IP.
- **La sesión abierta sigue valiendo si la cuenta se bloquea:** como en 001; desactivar o restablecer la corta.
- **Academia reactivada:** sus sesiones no vencidas vuelven a valer (pregunta T2).
- **Límite por IP en memoria, detrás de un proxy y con el WiFi de la piscina:** todas las peticiones de la misma red
  cuentan juntas; se revisa con el hosting y `trust proxy` (pregunta T1).
- **Cerrar sesión cierra todos los dispositivos de la cuenta** (pregunta N8): en la cuenta compartida por la familia
  (RN-29), cerrar sesión en un celular la cierra en los demás.
- **El Superadmin ve el DNI y el nombre de los administradores** (pregunta N5): es lo mínimo para crearlos y
  restablecerlos; no ve otros usuarios ni otros datos.

## Decisiones

### Decisiones de diseño (técnicas)

- **Una cookie `aq_sesion` con `Path=/api` y rutas sin nombre corto** (`/api/sesion`, `/api/usuarios`; D-27: la
  academia sale de la cuenta). Alternativa descartada: una cookie por academia con rutas `/api/a/{nombreCorto}/…`
  (obliga a comprobar en cada ruta que la academia de la dirección es la de la sesión, justo el error que RLS no ve).
- **Sesión exigida por un middleware de todo `/api` salvo las rutas públicas y de plataforma, más un guard de permisos
  que falla cerrado.** Alternativa descartada: un guard por controlador (una ruta nueva sin guard quedaría abierta).
- **Rol, estado y cambio obligatorio leídos de la base en cada petición, no del token.** Alternativa descartada: rol en
  el token (un cambio no se vería hasta que venza).
- **Lo que el Superadmin hace en una academia se audita en la `auditoria` de esa academia, en la misma transacción.**
  Alternativa descartada: `auditoria_plataforma` (no se puede escribir en la misma transacción que `usuarios`, porque
  cada transacción tiene una sola academia o la plataforma; quedaría una operación sin su registro si la segunda
  falla).
- **El Superadmin no opera sobre academias suspendidas:** `conAcademia` no se amplía (403). Alternativa descartada:
  una opción para saltar la suspensión (abre un camino que 001 cerró a propósito).
- **El límite por IP del ingreso cuenta todas las academias juntas.** Alternativa descartada: por academia (un
  atacante multiplicaría sus intentos por el número de academias).

## Preguntas abiertas

### De negocio (las decide Bryan)

- **N1. ¿El personal también empieza con la contraseña igual a su DNI y debe cambiarla al entrar?** RN-02 lo dice del
  alumno. **Propuesta:** sí, para todos los roles: quien crea la cuenta nunca conoce la contraseña final. **Valor
  provisional:** la propuesta (criterios 30 y 39).
- **N2. ¿Qué reglas tiene la nueva contraseña?** **Propuesta:** de 8 a 128 caracteres, distinta del DNI y de la
  actual; sin exigir números ni símbolos (la usa toda la familia). **Valor provisional:** la propuesta (criterio 23).
- **N3. ¿Cuántos intentos fallidos bloquean la cuenta y por cuánto tiempo?** **Propuesta:** 5 intentos y 15 minutos,
  como el Superadmin (DR-3); el restablecimiento desbloquea; 003 los hace configurables. **Valor provisional:** la
  propuesta (criterio 9).
- **N4. ¿Quién puede restablecer la contraseña de quién?** HU-05 solo dice que la secretaria restablece la del alumno.
  **Propuesta:** la secretaria, solo a alumnos; el administrador, a cualquier usuario de su academia menos a sí mismo.
  **Valor provisional:** la propuesta (criterio 36).
- **N5. ¿Qué más hace el Superadmin con los administradores?** D-29 y DR-1 dicen que crea el primero. **Propuesta:**
  puede crear más administradores, ver la lista de administradores de cada academia (DNI, nombre, estado y si está
  bloqueado) y restablecer la contraseña de uno; así, si el único administrador olvida su contraseña, la academia no
  queda sin acceso. No ve ni toca a nadie más. **Valor provisional:** la propuesta (criterios 38 a 40).
- **N6. ¿El administrador puede desactivar y reactivar al personal?** El modelo tiene `estado` en `USUARIO`, pero
  ninguna HU lo pide. **Propuesta:** sí, para que una secretaria o un entrenador que deja la academia pierda el acceso
  al instante; sin borrar la cuenta; no a sí mismo; los alumnos no (su estado es de la historia 010). **Valor
  provisional:** la propuesta (criterios 31 y 32).
- **N7. ¿Una cuenta tiene un solo rol?** Con el DNI único por academia (D-28), una persona tiene una sola cuenta en
  cada academia. **Propuesta:** sí, un rol por cuenta en el MVP; una secretaria no puede ser además alumna de la misma
  academia con la misma cuenta. **Valor provisional:** la propuesta.
- **N8. ¿Cuánto dura la sesión y qué cierra "Cerrar sesión"?** **Propuesta:** 12 horas para el personal (una jornada de
  08:00 a 20:00) y 30 días para el alumno (muestra su carnet desde el celular sin entrar cada día); "Cerrar sesión"
  cierra la cuenta en todos los dispositivos, también el celular del hijo o del padre que la comparten. **Valor
  provisional:** la propuesta (criterios 5 y 17).
- **N9. ¿Qué se guarda en la auditoría?** **Propuesta:** la creación, desactivación y reactivación de cuentas, los
  restablecimientos y los cambios de la propia contraseña; los inicios de sesión solo en el registro técnico, como en
  001 (DR-7). **Valor provisional:** la propuesta (criterio 42).
- **N10. ¿Solo se aceptan DNI de 8 dígitos?** HU-01 lo exige al alumno. **Propuesta:** sí, también para el personal;
  el carné de extranjería u otros documentos quedan para después del MVP. **Valor provisional:** la propuesta.

### Técnicas (las decide el orquestador)

- **T1. Límite por IP del ingreso.** En la piscina, muchos alumnos pueden entrar desde la misma red WiFi (una sola IP
  pública). **Propuesta:** 10 por minuto por IP, como el Superadmin; con sesiones largas para el alumno, los ingresos
  son pocos; se revisa con el hosting y `trust proxy`. **Valor provisional:** la propuesta (criterio 12).
- **T2. Sesiones de una academia reactivada.** DR-4 dice que las sesiones "dejan de valer" al suspender. **Propuesta:**
  mientras está suspendida no pasa ninguna petición (403); al reactivarla, las sesiones no vencidas vuelven a valer
  (cortarlas exigiría tocar `usuarios` desde la plataforma). **Valor provisional:** la propuesta (criterio 15).
- **T3. Una sesión de academia por navegador.** **Propuesta:** aceptarlo; entrar a otra academia reemplaza la sesión.
  **Valor provisional:** la propuesta.
