# 002 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes") y la spec [`001-academias-aislamiento`](../001-academias-aislamiento/spec.md). Lo que no es
orientativo es el contrato de `spec.md`.

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
- No se agregan funciones de PostgreSQL: la academia del ingreso se resuelve con `resolver_academia` (001) y la
  búsqueda por DNI corre ya dentro de `conAcademia`.

### 2. Inicio de sesión (`SesionAcademiaService.iniciarSesion`)

Mismo patrón que `SesionPlataformaService` (001), cambiando `comoPlataforma` por `conAcademia(academia.id, …)`:

1. El middleware de `/api/a` cuenta la petición en el límite por IP (clave `inicio-sesion-academia:<ip>`, sin la
   academia) antes de leer el cuerpo y de resolver la academia (criterio 12).
2. `ResolverAcademiaPipe` da la academia activa (404 o 403 si no; criterio 11). El cuerpo se valida (400; criterio 13).
3. `conAcademia`: `SELECT … FROM usuarios WHERE dni = $1`. Sin fila: verificar contra el hash ficticio y 401.
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

### 8. Web

- `RutaConSesion` consulta `GET /api/sesion`: 401 → página "Entra por el enlace de tu academia"; 403
  `ACADEMIA_SUSPENDIDA` → "Academia no disponible por el momento"; `debeCambiarClave` → `/cambiar-clave`.
- El menú de `/panel` se arma con `puede(rol, permiso)` de los contratos (solo muestra; quien decide es la API).
- Al cerrar sesión se vacía la caché de TanStack Query. Nada se guarda en `localStorage` ni `sessionStorage`.
- Fechas con las utilidades de `frontend/src/lib/` en America/Lima.

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

## Migraciones

- `<marca>_usuarios`: enums, tabla `usuarios`, `CHECK`, `UNIQUE (academia_id, id)`, `UNIQUE (academia_id, dni)`,
  índice, RLS forzada, políticas y privilegios. Falla con el mensaje de 001 si falta el rol `aquagestion_app`.
- En Windows: `npm run db:migrar` (no hay roles ni bases nuevas). La guía lo recuerda.

## Riesgos

- **Costo de argon2 por ingreso:** cada intento calcula un hash (decenas de ms); el límite por IP acota el abuso.
- **Una consulta más por petición** (verificar la sesión): aceptable en el MVP; si pesa, se combina con la de la
  operación, nunca con una caché entre peticiones.
- **Prueba del criterio 27:** depende de cómo Nest expone las rutas; si `DiscoveryService` no alcanza, se usa la pila
  del router de Express. El revisor confirma que cubre los controladores de todos los módulos.
- **Actualizar la prueba protegida de privilegios de 001:** debe hacerse en un commit de pruebas protegidas, o el
  verificador de la CI lo rechaza.
