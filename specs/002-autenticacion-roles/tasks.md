# 002 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica:
las pruebas protegidas se escriben y se confirman en rojo antes de implementar (T1 a T4), y el ataque adversarial corre
después de la implementación (T17). No se empieza T1 sin la aprobación del responsable.

Especificación aprobada por el responsable el 13/11/2026, con las propuestas de todas las preguntas de negocio (DR-1 a
DR-10 de 002); el orquestador aprobó las técnicas (DT-1 a DT-3). Están en "Decisiones" de `spec.md`; ningún criterio
cambió. Se puede empezar por T1.

Precisiones del orquestador (13/11/2026), PO-1 a PO-8 en "Decisiones" de `spec.md`: se reflejan en T3a (prueba
protegida nueva), T3b (ajuste de las pruebas ya escritas), T6, T11 y T15.

## Aprobación

- [x] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas abiertas N1 a N10 (Bryan) y
      T1 a T3 (orquestador), 13/11/2026 (todos los criterios)

## Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidades `backend/test/utilidades/usuarios.ts` según el contrato; pruebas protegidas de la
      tabla, el catálogo, los privilegios y RLS de `usuarios`; actualización de la prueba protegida de privilegios de
      001 para sumar los de `usuarios`, sin quitar nada (criterios 1 a 4)
- [ ] T2 · test-writer · Pruebas protegidas del ingreso, la sesión, el cierre, la protección de las rutas de academia,
      la separación de cookies, el cambio obligatorio y voluntario de contraseña, y el registro técnico (criterios 5 a
      25 y 43)
- [ ] T3 · test-writer · Pruebas protegidas de la matriz (unitaria), del guard y del recorrido de rutas, de la gestión
      del personal, del restablecimiento, de las rutas del Superadmin y de la auditoría (criterios 26 a 42)
- [ ] T3a · test-writer · _(Precisión del orquestador (13/11/2026), PO-3; prueba protegida adicional.)_ Prueba de
      integración de la ampliación del criterio 43: búsquedas con `POST /api/usuarios/buscar-por-dni` (DNI de A,
      inexistente, solo de B, con formato inválido, con espacios; por `ADMIN`, `SECRETARIA`, sin sesión, por
      `ENTRENADOR`, con cambio obligatorio y con cuerpo inválido) con el registro en nivel `trace` sin el DNI buscado;
      `GET /api/usuarios/por-dni/{dni}` con sesión de `ADMIN` responde 404. Usar DNIs que no estén ya en el registro
      acumulado (pueden aparecer dentro de un UUID) (criterios 34 y 43)
- [ ] T3b · test-writer · _(Precisiones del orquestador (13/11/2026).)_ Ajustar las pruebas protegidas ya escritas, en
      el mismo commit de pruebas protegidas y antes de T4: la búsqueda por DNI pasa a `POST /api/usuarios/buscar-por-dni`
      con `{ dni }` en el cuerpo (PO-3; hoy usan `GET /api/usuarios/por-dni/…`, entre otras, `restablecer-clave.test.ts`,
      `sesion.test.ts`, `cambio-obligatorio.test.ts` y `permisos-rutas.test.ts`; en el recorrido del criterio 27, la
      ruta es `POST /api/usuarios/buscar-por-dni`); `@UsuarioActual()` como fábrica (PO-1); celda `TODO` del `ADMIN` en
      `RESTABLECER_CLAVE` (PO-2); listas con inactivos (PO-4); `reactivar` sobre un alumno 404 y restablecer a un
      inactivo 200 sin reactivarlo, también por el Superadmin (PO-5); el límite por IP probado con una sola instancia
      (PO-6); tras el plazo de bloqueo, comprobar el contador y no que `bloqueado_hasta` sea nulo (PO-7) (criterios 9,
      12, 26, 27, 29, 32, 34, 35, 38, 40)
- [ ] T4 · tester · Confirmar que T1 a T3b fallan por falta de la funcionalidad (tabla, rutas o módulos inexistentes) y
      no por sintaxis, importaciones o configuración. Commit del orquestador: "Pruebas protegidas (002): autenticación,
      roles y usuarios por academia (en rojo)"

## Implementación

- [ ] T5 · backend · Contratos `sesion.ts`, `usuarios.ts` y `permisos.ts` con sus pruebas unitarias (criterios 26, 44)
- [ ] T6 · backend · Esquema de Prisma y migración `usuarios`; `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs`; y
      _(precisión del orquestador (13/11/2026), PO-8)_ sumar `'usuarios'` a `TABLAS_DESPUES_DE_MIGRAR` de
      `scripts/test/integracion/migraciones.test.mjs` (no protegida), en el mismo cambio (criterios 1 a 4)
- [ ] T7 · backend · Seguridad compartida: claim `aca` en los tokens, cookie `aq_sesion`, duración por rol y
      `REGLAS_BLOQUEO_USUARIO` (criterios 5, 6, 9)
- [ ] T8 · backend · `SesionAcademiaService` y su controlador: ingreso, `GET` y `DELETE /api/sesion`, límite por IP en
      el middleware de `/api/a`, registro técnico (criterios 5 a 13, 17, 43)
- [ ] T9 · backend · Middleware de las rutas de academia, verificación de la sesión, cambio obligatorio, `PermisosGuard`
      y decoradores (criterios 14 a 16, 18 a 21, 27, 28)
- [ ] T10 · backend · Cambio de contraseña (criterios 22 a 25)
- [ ] T11 · backend · `UsuariosService` y su controlador: listar, crear, desactivar, reactivar, buscar por DNI y
      restablecer, con auditoría (criterios 29 a 37, 42). _(Precisión del orquestador (13/11/2026):)_ la búsqueda es
      `POST /api/usuarios/buscar-por-dni` con `buscarUsuarioPorDniSchema` en los contratos, sin el DNI en ningún
      registro (PO-3, ampliación del criterio 43); listas con inactivos (PO-4); `reactivar` sobre alumno 404 y
      restablecer sin tocar `estado` (PO-5); `@UsuarioActual()` como fábrica (PO-1)
- [ ] T12 · backend · Rutas del Superadmin para los administradores de cada academia (criterios 38 a 41)
- [ ] T13 · backend · Semilla con usuarios de ejemplo (criterio 45)
- [ ] T14 · frontend · `/a/:nombreCorto/ingresar`, `/cambiar-clave`, `RutaConSesion` y `/panel` (criterios 46 a 48)
- [ ] T15 · frontend · `/panel/usuarios`, `/panel/restablecer` y diálogo de administradores de la plataforma
      (criterios 49, 50). _(Precisión del orquestador (13/11/2026), PO-3:)_ `/panel/restablecer` busca con
      `POST /api/usuarios/buscar-por-dni`, sin el DNI en la dirección de la API ni de la página (criterio 43)
- [ ] T16 · test-writer · Prueba E2E del flujo Superadmin → administrador → secretaria (criterio 51)

## Ataque y cierre

- [ ] T17 · adversarial · Atacar la ruta crítica con la spec y el código (sin el razonamiento de quien implementó):
      aislamiento entre academias por id, DNI, token (`aca`, `sub`) y cookies; permisos por rol y rutas sin
      declaración; bloqueo y límite bajo concurrencia; cambio obligatorio; versión de token; academia suspendida; datos
      en el registro técnico. Por cada falla: el especificador agrega el criterio, test-writer la prueba en rojo, se
      corrige y se vuelve a atacar
- [ ] T18 · revisor · Comparar con la spec y las convenciones (`CLAUDE.md` y "Reglas para las historias siguientes" de
      `docs/arquitectura.md`); confirmar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T19 · tester · Suite completa, lint y verificación de tipos (Linux; la CI también en Windows)
- [ ] T20 · documentador · Commit final, tareas marcadas, `README.md`, `docs/guia-local-windows.md` (criterio 52) y
      `docs/arquitectura.md` (sesión de academia, matriz de permisos, `@Permiso` y `@SoloSesion` para las historias
      siguientes)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
