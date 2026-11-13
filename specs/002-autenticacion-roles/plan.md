# 002 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes") y la spec [`001-academias-aislamiento`](../001-academias-aislamiento/spec.md). Lo que no es
orientativo es el contrato de `spec.md`.

**Estado:** aprobado junto con la spec el 13/11/2026. Las preguntas quedaron resueltas con su propuesta (DR-1 a DR-10
de 002 y DT-1 a DT-3 en "Decisiones" de `spec.md`), así que el diseño no cambia: los valores de bloqueo (5 intentos,
15 minutos; DR-3), las duraciones de sesión (12 h y 30 días; DR-8), el límite por IP compartido (10 por minuto; DT-1),
el alcance del restablecimiento (DR-4) y las rutas del Superadmin (DR-5) son los de este plan.

**Precisiones del orquestador (13/11/2026):** PO-1 a PO-8 de `spec.md` ("Decisiones"). En este plan cambian la
búsqueda por DNI (PO-3: `POST /api/usuarios/buscar-por-dni`, secciones 5, 7 y 8), el límite por IP (PO-6, sección 2 y
"Riesgos") y la tabla de la prueba de migraciones (PO-8, sección 1).

**Ataque ronda 1 (13/11/2026):** criterios 53 y 54 de `spec.md` (decisiones AR1-1 y AR1-2). Cambian el ingreso con
un DNI sin cuenta (sección 2, paso 3) y el cierre de sesión con cuerpo (sección 3); el diseño de los dos está en la
sección 9. Se suman filas a "Decisiones" y a "Riesgos".

## Módulos afectados

```
piscina/
├── packages/contratos/src/
│   ├── sesion.ts · usuarios.ts · permisos.ts      nuevos (+ *.test.ts)
│   └── index.ts                                    + exportaciones
├── backend/
│   ├── prisma/schema.prisma                        + modelo Usuario, enums RolUsuario y EstadoUsuario
│   ├── prisma/migrations/<marca>_usuarios/         tabla, CHECK, índices, RLS forzada, políticas y privilegios
│   ├── prisma/seed.ts                              + usuarios de ejemplo (criterio 45)
│   ├── src/infraestructura/prisma/privilegios-app.ts   + privilegios de usuarios (criterio 2)
│   ├── src/infraestructura/seguridad/
│   │   ├── tokens.ts                               + claim opcional `aca`
│   │   └── cookies.ts                              + aq_sesion, opcionesCookieAcademia
│   ├── src/modulos/autenticacion/                  nuevo
│   │   ├── sesion-academia.controller.ts           POST /a/:nombreCorto/sesion, GET/DELETE /sesion, POST /sesion/clave
│   │   ├── sesion-academia.service.ts              ingreso, verificación de la sesión, cierre y cambio de clave
│   │   ├── proteccion-academia.ts                  middleware de las rutas de academia (criterios 18, 21)
│   │   ├── permisos.guard.ts · permiso.decorator.ts · usuario-actual.decorator.ts
│   │   ├── dominio/duracion-sesion.ts              duración por rol (función pura)
│   │   └── index.ts
│   ├── src/modulos/usuarios/                       nuevo
│   │   ├── usuarios.controller.ts                  /usuarios…
│   │   ├── usuarios.service.ts                     crearEnTransaccion, listar, desactivar, reactivar, restablecer
│   │   ├── dominio/alcance-restablecimiento.ts     quién restablece a quién (función pura, criterio 36)
│   │   ├── dominio/politica-clave.ts               clave nueva distinta del DNI y de la actual (criterio 23)
│   │   └── index.ts
│   ├── src/modulos/academias/
│   │   ├── administradores-plataforma.controller.ts  /plataforma/academias/:id/administradores…
│   │   └── proteccion-de-prefijos.ts               + límite por IP de POST /api/a/*/sesion; instala la de academia
│   └── test/
│       ├── utilidades/usuarios.ts                  contrato de spec.md (test-writer)
│       └── integracion/autenticacion/ · usuarios/ · plataforma/
├── scripts/lib/rol-app.mjs                         + privilegios de usuarios (misma lista que PRIVILEGIOS_APP)
├── frontend/src/
│   ├── api/sesion.ts                               consultas de sesión (TanStack Query)
│   ├── rutas/Rutas.tsx · rutas/RutaConSesion.tsx   + /a/:nombreCorto/ingresar, /cambiar-clave, /panel/*
│   ├── modulos/sesion/                             PaginaIngresarAcademia, PaginaCambiarClave
│   ├── modulos/panel/                              PaginaPanel (menú según MATRIZ_PERMISOS)
│   ├── modulos/usuarios/                           PaginaUsuarios, PaginaRestablecer
│   └── modulos/plataforma/DialogoAdministradores.tsx
├── e2e/pruebas/autenticacion.spec.ts               criterio 51
└── docs/guia-local-windows.md · README.md          documentador (criterio 52)
```

## Diseño

### 1. Tabla y migración

- Migración `<marca>_usuarios` escrita a mano para lo que Prisma no genera: `CHECK` del DNI, `ENABLE` y `FORCE ROW
  LEVEL SECURITY`, tres políticas (`SELECT`, `INSERT`, `UPDATE`) con la forma exacta de la 001 (criterio 132),
  `GRANT SELECT, INSERT` y `GRANT UPDATE (columnas…)` a `aquagestion_app`. Enums `rol_usuario` y `estado_usuario`.
- `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se amplían en el mismo cambio (la prueba que las compara falla si no).
- _(Precisión del orquestador (13/11/2026), PO-8.)_ En el mismo cambio, `TABLAS_DESPUES_DE_MIGRAR` de
  `scripts/test/integracion/migraciones.test.mjs` (no protegida) suma `'usuarios'`.
- No se agregan funciones de PostgreSQL: la academia del ingreso se resuelve con `resolver_academia` (001) y la
  búsqueda por DNI corre ya dentro de `conAcademia`.

### 2. Inicio de sesión (`SesionAcademiaService.iniciarSesion`)

Mismo patrón que `SesionPlataformaService` (001), cambiando `comoPlataforma` por `conAcademia(academia.id, …)`:

1. El middleware de `/api/a` cuenta la petición en el límite por IP (clave `inicio-sesion-academia:<ip>`, sin la
   academia) antes de leer el cuerpo y de resolver la academia (criterio 12). _(Precisión del orquestador
   (13/11/2026), PO-6:)_ el contador es el mismo almacén en memoria del límite del Superadmin (001), por instancia.
2. `ResolverAcademiaPipe` da la academia activa (404 o 403 si no; criterio 11). El cuerpo se valida (400; criterio 13).
3. `conAcademia`: `SELECT … FROM usuarios WHERE dni = $1`. Sin fila: verificar contra el hash ficticio y 401.
   _(Ataque ronda 1, F1: además, antes del 401, la transacción del conteo del paso 5 sobre un id que no existe;
   sección 9.1 y criterio 53.)_
4. Si está bloqueado (`estaBloqueado`), 423. Fuera de la transacción, `verificarClave`.
5. Clave equivocada: `conAcademia` con `SELECT … FOR UPDATE`, `evaluarIntentoFallido(estado, ahora,
   REGLAS_BLOQUEO_USUARIO)` y `UPDATE` (401 o 423).
6. Clave correcta: `conAcademia` con `FOR UPDATE`; si el hash o la versión cambiaron desde la lectura, 401 (patrón del
   criterio 120 de 001); si está bloqueado, 423; si está `INACTIVO`, 403 `USUARIO_INACTIVO`; si no, contador en 0 y
   `ultimo_acceso`. Se firma el token con `aca` y la duración del rol, y se responde con la cookie.

`REGLAS_BLOQUEO_USUARIO = { maximoIntentos: 5, minutosBloqueo: 15 }` vive en `modulos/autenticacion/dominio/` e importa
`evaluarIntentoFallido` y `estaBloqueado` de `modulos/academias/dominio/bloqueo.ts` (no se mueve el archivo). 003 lo
reemplaza por la lectura de la configuración.

### 3. Verificación de la sesión y protección de las rutas

- `proteccion-academia.ts` se instala en `configurarApp` junto con las de 001, antes del lector del cuerpo: para
  `/api/*` que no sea `/api/salud`, `/api/plataforma…` ni `/api/a/…`, fija `Cache-Control: no-store`; si es `DELETE
  /api/sesion`, sigue; si no, llama a `SesionAcademiaService.autenticar(solicitud)` (401/403 con `responderError`).
  _(Ataque ronda 1, F2: "sigue" no basta: después venía el lector de cuerpos de 001, que respondía 400. `DELETE
  /api/sesion` no pasa por el lector; sección 9.2 y criterio 54.)_
- `autenticar` lee solo la cookie `aq_sesion`, verifica el token (`tipo === 'academia'`, `aca` y `sub` UUID) y, en
  `conAcademia(aca, …)`, lee la fila del usuario (`id`, `rol`, `estado`, `version_token`, `debe_cambiar_clave`,
  `nombres`, `apellidos`) y el nombre de la academia. Recuerda el resultado por petición con un `WeakMap` (como la
  plataforma); nunca entre peticiones.
- Con `debe_cambiar_clave`, el middleware responde 403 `CAMBIO_DE_CLAVE_OBLIGATORIO` salvo para `GET /api/sesion` y
  `POST /api/sesion/clave` (criterio 21).
- `PermisosGuard` (guard global de Nest) solo actúa en las rutas de academia: lee la metadata de `@Permiso` o
  `@SoloSesion` del manejador o de la clase; sin metadata, 403 `SIN_PERMISO`; con `@Permiso(p)`, exige
  `puede(rol, p)` de `MATRIZ_PERMISOS` (criterios 27 y 28).
- `@UsuarioActual()` entrega el `UsuarioAutenticado`. Los servicios reciben `usuario.academiaId` y nunca un id de
  academia de la petición (criterio 20).
- Prueba del criterio 27: recorrer las rutas con `DiscoveryService` y `MetadataScanner` de Nest (o el router de
  Express), filtrar las de academia y exigir la metadata.

### 4. Cambio de contraseña

1. Validar el cuerpo (400) y la política: distinta del DNI (comparación exacta) — criterio 23.
2. Bajo `conAcademia`: leer la fila; si está bloqueado, 423.
3. Fuera de la transacción: `verificarClave(hash, claveActual)`; si no coincide, contar el fallo como en el ingreso y
   responder 400 `CLAVE_ACTUAL_INCORRECTA` (o 423 si este fallo bloquea). Comprobar que la nueva no es la actual
   (`verificarClave(hash, claveNueva)`), y calcular `hashearClave(claveNueva)`.
4. `conAcademia` con `FOR UPDATE`: si `clave_hash` o `version_token` cambiaron desde la lectura, 400
   `CLAVE_ACTUAL_INCORRECTA` (criterio 25); si no, `UPDATE` (hash, `debe_cambiar_clave = false`, `version_token + 1`,
   contador en 0) y auditoría `USUARIO_CLAVE_CAMBIADA`. Se firma un token nuevo con la versión nueva.

### 5. Usuarios (`UsuariosService`)

- `crearEnTransaccion`: `INSERT … ON CONFLICT (academia_id, dni) DO NOTHING RETURNING`; sin fila, 409 `DNI_EN_USO`;
  con fila, auditoría `USUARIO_CREADO`. El hash del DNI se calcula antes de abrir la transacción.
- `listarPersonal`: `WHERE rol IN ('ADMIN','SECRETARIA','ENTRENADOR') ORDER BY apellidos, nombres, id`.
- `desactivar` y `reactivar`: `SELECT … FOR UPDATE` (404 si no existe o no es personal), comprobaciones de 409,
  `UPDATE` y auditoría en la misma transacción. Desactivar sube `version_token`.
- `buscarParaRestablecer(dni, actor)` y `restablecer(id, actor)`: la regla de alcance es la función pura
  `puedeRestablecer(actor, objetivo)` del dominio. Restablecer: leer el DNI (transacción 1), `hashearClave(dni)` fuera,
  y en la transacción 2 `UPDATE … WHERE id = $1` con `FOR UPDATE` previo y auditoría.
- Los ids de la dirección se validan como UUID antes de consultar; uno inválido es 404 (criterio 33).
- _(Precisión del orquestador (13/11/2026), PO-3.)_ `buscarParaRestablecer` se expone como
  `POST /api/usuarios/buscar-por-dni` (`@Permiso('RESTABLECER_CLAVE')`, `@HttpCode(200)`), con el cuerpo validado por
  `buscarUsuarioPorDniSchema`; el servicio recorta y, si no son 8 dígitos, responde 404 sin consultar. Ojo con el
  orden de las rutas: `buscar-por-dni` es un segmento literal y no debe confundirse con `{id}` (las rutas con `{id}`
  tienen un segundo segmento y validan UUID).
- _(PO-4.)_ `listarPersonal` no filtra por estado. _(PO-5.)_ `reactivar` sobre un alumno, 404 (mismo `SELECT … FOR
  UPDATE` que desactivar, que ya filtra el personal); restablecer no toca `estado`.

### 6. Superadmin y administradores

`AdministradoresPlataformaController` vive en `modulos/academias` (bajo `/api/plataforma`, ya protegido por la sesión
del superadmin, P-7 de 001). Llama a `UsuariosService` con `conAcademia(id, …)` y actor `SUPERADMIN`; todas sus
consultas filtran `rol = 'ADMIN'`. `conAcademia` da 404 `ACADEMIA_NO_ENCONTRADA` o 403 `ACADEMIA_SUSPENDIDA`
(criterio 41). La auditoría va a `auditoria` de esa academia (decisión de la spec).

### 7. Registro técnico

Cada resultado del ingreso, del cambio y del restablecimiento se registra con `{ usuarioId?, academiaId, ip }` y un
mensaje fijo. El cuerpo de la petición nunca se registra; los errores de la base, con `errorParaRegistro` (001). Una
prueba lee el destino del registro (`crearAppDePruebas({ destinoRegistro })`) y busca la clave, el DNI escrito y el
token (criterio 43).

_(Precisión del orquestador (13/11/2026), PO-3.)_ Con la búsqueda por `POST`, el DNI buscado no aparece en `req.url`
de pino-http ni en el filtro de errores, sin redactar nada: basta con no registrar el cuerpo (ya es la regla) y con
que el servicio registre, si lo hace, el id encontrado. No se agrega un serializador de `req.url`. La prueba de la
ampliación del criterio 43 usa nivel `trace`.

### 8. Web

- `RutaConSesion` consulta `GET /api/sesion`: 401 → página "Entra por el enlace de tu academia"; 403
  `ACADEMIA_SUSPENDIDA` → "Academia no disponible por el momento"; `debeCambiarClave` → `/cambiar-clave`.
- El menú de `/panel` se arma con `puede(rol, permiso)` de los contratos (solo muestra; quien decide es la API).
- Al cerrar sesión se vacía la caché de TanStack Query. Nada se guarda en `localStorage` ni `sessionStorage`.
- Fechas con las utilidades de `frontend/src/lib/` en America/Lima.
- _(Precisión del orquestador (13/11/2026), PO-3.)_ `/panel/restablecer` busca con `POST /api/usuarios/buscar-por-dni`
  (una mutación de TanStack Query o una consulta con `POST`); el DNI no va en la dirección de la página (`?dni=`) ni
  en la clave de una consulta que se guarde fuera de la memoria.

### 9. Ataque ronda 1 (criterios 53 y 54)

#### 9.1. El mismo trabajo con un DNI sin cuenta (F1, criterio 53)

Hoy (`sesion-academia.service.ts`, `iniciarSesion`): sin fila, solo `verificarClave` contra el hash ficticio; con
fila y clave equivocada, `rechazarIntento` → `contarFallo` → `contarFalloEnBase` (`conAcademia` con `SELECT
intentos_fallidos, bloqueado_hasta … FOR UPDATE` y, si hay fila, `UPDATE`). Además, `contarFalloEnBase` sale antes
del `UPDATE` cuando el `SELECT` no devuelve fila (`DESAPARECIDO`), así que llamarla con un id inexistente tampoco
daría la misma secuencia.

Diseño:

- Una sola función del servicio produce las dos sentencias del conteo, para que su texto no pueda divergir: el
  `SELECT … FOR UPDATE` y el `UPDATE … WHERE academia_id = $1 AND id = $2` se ejecutan **siempre los dos**, también
  cuando el `SELECT` no devuelve fila. Sin fila, el `UPDATE` lleva valores neutros (por ejemplo los que daría
  `evaluarIntentoFallido` sobre un estado vacío) y afecta 0 filas; el resultado sigue siendo `DESAPARECIDO`.
- Con un DNI sin cuenta, tras `verificarClave` contra el hash ficticio, se llama a esa misma función con
  `randomUUID()` (un id que no existe; la probabilidad de chocar con uno real es despreciable, ver "Riesgos") y se
  ignora el resultado; luego, 401.
- El caso de carrera `YA_BLOQUEADA` (la cuenta se bloqueó entre la primera lectura y el conteo) puede seguir sin
  `UPDATE`: responde 423, que ya revela la cuenta (riesgo aceptado "Saber si un DNI tiene cuenta").
- El orden de los pasos queda igual en los dos caminos: lectura por DNI (transacción 1), argon2 fuera de la
  transacción, conteo (transacción 2), respuesta. El registro técnico no cambia.
- Lo que la prueba observa: las sentencias que llegan a `pg`. `@prisma/adapter-pg` usa el `pg` del repositorio; la
  prueba espía `Client.prototype.query` (o el `query` del cliente que entrega el `Pool`) del mismo módulo que carga la
  API, y normaliza el texto (de la cadena o de `config.text`). Las comprobaciones de una vez por proceso
  (`#verificarRol`, el hash ficticio) quedan fuera con una petición de calentamiento.

#### 9.2. `DELETE /api/sesion` no lee el cuerpo (F2, criterio 54)

Hoy, en `comun/http/cuerpos.ts`, los tres middlewares de cuerpos (tipo de contenido, codificación y lector JSON con su
manejador de errores) atienden todo `/api` con `POST`, `PUT`, `PATCH` o `DELETE`. Para una petición autenticada de una
academia, el error se guarda y lo lanza el guard después del permiso (`guardarErrorDeCuerpo`); pero
`DELETE /api/sesion` no pasa por la autenticación del middleware, así que el error se responde al instante (400 o
413) y el manejador no corre.

Diseño:

- Los middlewares de cuerpos se saltan `DELETE /api/sesion` (comprobación por método y ruta, con la misma
  normalización de ruta que usa el middleware de academia para reconocerla, para que no difieran). El lector JSON
  tampoco la lee: `useBodyParser('json', …)` recibe un `type` que devuelve `false` para esa petición, o el salto se
  hace antes de instalarlo; lo que quede del cuerpo lo descarta Node al terminar la respuesta (o
  `solicitud.resume()`), sin interpretarlo.
- El manejador de `DELETE /api/sesion` no declara `@Body()` ni valida nada; `cerrarSesion` no cambia.
- Las demás rutas siguen con las reglas de 001 (criterios 74, 89 y 105); `DELETE /api/plataforma/sesion` no cambia
  (pregunta T4 de `spec.md`).

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Cookie única `aq_sesion` (`Path=/api`) y rutas sin nombre corto | Cookie y rutas por academia | La academia sale de la sesión (D-27); evita comparar la dirección con la sesión en cada ruta |
| Middleware de sesión para todo `/api` salvo públicas y plataforma | Guard por controlador | Falla cerrada: una ruta nueva nace protegida, también las inexistentes (P-7 de 001) |
| Guard de permisos global que exige metadata | Permisos opcionales por ruta | Una ruta sin declaración responde 403, no queda abierta |
| Rol y estado desde la base en cada petición | Rol en el token | Desactivar o restablecer se nota al instante; una consulta por petición es barata |
| Auditoría del Superadmin en la `auditoria` de la academia | `auditoria_plataforma` | Una transacción solo tiene una academia o la plataforma; así la operación y su registro son atómicos |
| Hash argon2 fuera de las transacciones | Dentro | No retener una conexión del pool decenas de milisegundos (como 001) |
| Reutilizar `bloqueo.ts` de 001 sin moverlo | Moverlo a `infraestructura/seguridad` | Moverlo rompe las importaciones de pruebas protegidas de 001 |
| Límite por IP compartido entre academias | Por academia | No multiplica los intentos de un atacante por el número de academias |
| Valores de bloqueo y sesión como constantes | Leerlos ya de `configuraciones` | Las claves las define 003 (D-07, DR-8 de 001) |
| Con un DNI sin cuenta, la misma transacción de conteo sobre un id aleatorio inexistente (AR1-1, criterio 53) | Retardo fijo, aleatorio o tiempo mínimo de respuesta | Iguala la causa (las mismas sentencias y viajes a la base), no tapa el síntoma; un retardo depende de la carga y la máquina y alarga todos los ingresos |
| Comprobar F1 por las sentencias SQL, no por milisegundos (AR1-1) | Prueba de tiempos en la CI | Determinista en Linux y Windows; los tiempos los mide el adversarial en la ronda 2 |
| `DELETE /api/sesion` fuera del lector de cuerpos (AR1-2, criterio 54) | Leer el cuerpo y tolerar errores solo en esa ruta | No leer es más simple y no deja casos (tamaño, compresión, UTF-8) que se olviden |
| Búsqueda por DNI con `POST /api/usuarios/buscar-por-dni` y el DNI en el cuerpo (PO-3) | `GET /api/usuarios/por-dni/{dni}` con el segmento redactado en el registro | La redacción falla abierta (cada lugar que registre la dirección debe taparlo) y no alcanza a los registros del proxy del hosting; con `POST` el DNI no está en la dirección |

## Migraciones

- `<marca>_usuarios`: enums, tabla `usuarios`, `CHECK`, `UNIQUE (academia_id, id)`, `UNIQUE (academia_id, dni)`,
  índice, RLS forzada, políticas y privilegios. Falla con el mensaje de 001 si falta el rol `aquagestion_app`.
- En Windows: `npm run db:migrar` (no hay roles ni bases nuevas). La guía lo recuerda.

## Riesgos

- **Costo de argon2 por ingreso:** cada intento calcula un hash (decenas de ms); el límite por IP acota el abuso.
- **Límite por IP en memoria (PO-6):** por instancia; con varias instancias cada una cuenta por su lado y el contador
  se pierde al reiniciar. Se revisa con el hosting junto a `trust proxy` (DT-1).
- **Una consulta más por petición** (verificar la sesión): aceptable en el MVP; si pesa, se combina con la de la
  operación, nunca con una caché entre peticiones.
- **Prueba del criterio 27:** depende de cómo Nest expone las rutas; si `DiscoveryService` no alcanza, se usa la pila
  del router de Express. El revisor confirma que cubre los controladores de todos los módulos.
- **Commit con escritura frente a commit vacío (F1, ronda 1):** con el criterio 53, el `UPDATE` del DNI sin cuenta
  afecta 0 filas, no asigna un id de transacción ni escribe en el WAL, y su `COMMIT` no espera al disco; el del DNI con
  cuenta sí. Puede quedar una diferencia pequeña (de décimas de milisegundo a unos pocos, según el disco). La ronda 2
  la mide con los umbrales del criterio 53. Si no los cumple, opciones para que decida el orquestador: igualar la
  escritura (por ejemplo, un `UPDATE` sin cambios de valor sobre una fila propia, con su costo de bloqueos) o aceptarla
  como riesgo junto con "Saber si un DNI tiene cuenta".
- **Id aleatorio del conteo simulado (F1):** si `randomUUID()` coincidiera con el id de un usuario de esa academia, se
  contaría un fallo en su cuenta. La probabilidad es despreciable (122 bits aleatorios); se acepta.
- **Espiar `pg` desde la prueba (F1):** si el módulo `pg` que carga la prueba no es la misma instancia que usa el
  adaptador (por ejemplo, dos copias en `node_modules`), el espía no ve nada. La prueba debe fallar en ese caso (exigir
  que el calentamiento registre sentencias), y el test-writer lo informa al orquestador en lugar de cambiar el
  criterio.
- **Límite por IP con IPv6 (observación de la ronda 1):** por dirección exacta; agrupar por `/64` con el hosting
  (DT-1).
- **Actualizar la prueba protegida de privilegios de 001:** debe hacerse en un commit de pruebas protegidas, o el
  verificador de la CI lo rechaza.
