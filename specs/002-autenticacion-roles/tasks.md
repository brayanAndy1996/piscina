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

- [x] T17 · adversarial · Atacar la ruta crítica con la spec y el código (sin el razonamiento de quien implementó):
      aislamiento entre academias por id, DNI, token (`aca`, `sub`) y cookies; permisos por rol y rutas sin
      declaración; bloqueo y límite bajo concurrencia; cambio obligatorio; versión de token; academia suspendida; datos
      en el registro técnico. Por cada falla: el especificador agrega el criterio, test-writer la prueba en rojo, se
      corrige y se vuelve a atacar. _(Ronda 1 hecha el 13/11/2026: dos fallas, F1 y F2; se siguen en "Ataque ronda
      1".)_ _(Ataque ronda 4: ciclo terminado el 13/11/2026; la ronda 4, sobre 115cf7f, no encontró fallas.)_
### Ataque ronda 1 (13/11/2026)

F1: el tiempo de respuesta revela si un DNI tiene cuenta (criterio 53). F2: `DELETE /api/sesion` con cuerpo responde
400 y no cierra (criterio 54). Decisiones AR1-1 y AR1-2 de `spec.md`. T18 en adelante esperan a que la ronda 2 no
encuentre fallas. _(Ataque ronda 2: la ronda 2 encontró R2-F1; ahora esperan a la ronda 3, T17.17.)_ _(Ataque ronda
3: la ronda 3 encontró F1 y F2; ahora esperan a la ronda 4, T17.26.)_ _(Ataque ronda 4: sin fallas; T18 en adelante ya
pueden empezar.)_

- [x] T17.1 · especificador · Criterios 53 y 54 (sección K), notas en los criterios 7, 17, 34 y 36, contrato, DT-1,
      "Impacto", "Riesgos aceptados" y preguntas N11 y T4; plan, sección 9 (criterios 53, 54)
- [x] T17.2 · test-writer · Pruebas protegidas de integración, en rojo, desde la spec y sin mirar la implementación:
      el criterio 53 (las sentencias SQL que llegan a `pg` en los casos (i) a (iv), con calentamiento y cada caso dos
      veces; ninguna fila cambiada ni auditoría en (iii) y (iv); contador +1 en (i) y (ii); mismo 401) y el criterio 54
      (los ocho cuerpos con sesión válida y sin ella; 204, cookie borrada, `Cache-Control: no-store`, `version_token`
      +1 y 401 después; `POST /api/sesion/clave` con JSON roto sigue en 400 y con más de 100 KB en 413). Si el espía de
      `pg` no ve sentencias, avisar al orquestador (plan, "Riesgos") (criterios 53, 54)
- [x] T17.3 · tester · Confirmar que T17.2 falla por la razón esperada: en el 53, la secuencia de (iii) y (iv) tiene
      menos sentencias que la de (i) y (ii) (y no por un espía que no ve nada); en el 54, 400 o 413 en lugar de 204.
      Commit del orquestador: "Pruebas protegidas (002): ataque ronda 1 (en rojo)" (criterios 53, 54)
- [x] T17.4 · backend · F1: la transacción del conteo con las dos sentencias siempre, y con un DNI sin cuenta sobre un
      id aleatorio inexistente (plan, sección 9.1), sin tocar las pruebas protegidas (criterios 7, 53)
- [x] T17.5 · backend · F2: `DELETE /api/sesion` fuera de los middlewares y del lector de cuerpos (plan, sección 9.2),
      sin cambiar las reglas de cuerpos de las demás rutas ni `DELETE /api/plataforma/sesion` (criterios 17, 54)
- [x] T17.6 · orquestador · `git diff` de los commits de T17.4 y T17.5: ninguno toca pruebas protegidas (de 001 ni de
      002); suite en verde (criterios 1 a 54)
- [x] T17.7 · adversarial · Ronda 2, con la spec y el código: volver a medir los tiempos con la reproducción
      `a3.test.ts` y los umbrales del criterio 53 (mediana a menos de 2 ms; como mucho el 25 % sobre el percentil 90);
      buscar otros caminos que delaten un DNI (cambio de clave, usuario inactivo, carreras); `DELETE /api/sesion` con
      variantes de la ruta (barra final, mayúsculas, cadena de consulta) y cuerpos; que las demás rutas sigan
      rechazando cuerpos inválidos. Si encuentra fallas, se repite el ciclo (criterios 53, 54 y toda la ruta crítica)
      _(Hecha el 13/11/2026 sobre 16b0e38: una falla, R2-F1, y tres observaciones; se siguen en "Ataque ronda 2".)_
- [ ] T17.8 · responsable · Contestar N11 (el Superadmin conoce la clave inicial del administrador). No bloquea:
      mientras tanto rige la opción (a). Si elige (c), el especificador ajusta los criterios 39 y 40 y se repiten las
      pruebas protegidas de esos criterios (criterios 39, 40) _(Ataque ronda 4: sigue pendiente de Bryan, con el valor
      provisional (a); no bloquea el cierre.)_
- [x] T17.9 · orquestador · Decidir T4 (cierre de sesión del Superadmin con cuerpo, criterio 74 de 001). No bloquea
      _(Ataque ronda 4: decidida, DT-4: no se toca la 001; la nota en el backlog es T17.28.)_

### Ataque ronda 2 (13/11/2026, sobre 16b0e38)

R2-F1 (alta): un administrador desactivado se reactiva a sí mismo, o crea administradores, con una petición en curso
(criterios 55 a 57). Observación 1: la web no nota un cambio de sesión en otra pestaña (criterio 59, no crítico).
Observación 2: el cambio de clave mira el DNI antes de verificar la actual (criterio 58). Observación 3: el 409
`DNI_EN_USO` al Superadmin (riesgo aceptado). Tiempos del criterio 53: cumplen (riesgo aceptado ampliado). Decisiones
AR2-1 a AR2-5 de `spec.md`. _(Ataque ronda 1:)_ "T18 en adelante esperan a que la ronda 2 no encuentre fallas" pasa a
"a que la ronda 3 no encuentre fallas".

- [x] T17.10 · especificador · Criterios 55 a 59 (sección L), notas en los criterios 14, 16, 22, 23, 24, 30, 31, 32,
      35, 39 y 53, casos límite, contrato, DT-3, "Impacto", "Riesgos aceptados", decisiones AR2-1 a AR2-5 y pregunta
      T5; plan, sección 10 (criterios 55 a 59)
- [x] T17.11 · test-writer · Pruebas protegidas de integración, en rojo, desde la spec y sin mirar la implementación:
      - criterio 55: `ADMIN` que reactiva su propia cuenta → 409 `OPERACION_SOBRE_SI_MISMO`, sin cambios ni auditoría;
      - criterio 56: las carreras deterministas (i) a (vi), con la transacción de la prueba que retiene la fila del
        actor y la espera con `pg_blocking_pids` y un límite de seguridad (plan, sección 10.1): reactivación propia,
        crear (con las variantes de solo `version_token + 1` y solo `debe_cambiar_clave = true`), desactivar, reactivar
        y restablecer a otro, cambio de clave propia y el control con `ROLLBACK` → 201;
      - criterio 57: varias rondas de dos administradores que se desactivan entre sí a la vez → 200 y 401, nunca 500,
        uno activo y un solo `USUARIO_DESACTIVADO`;
      - criterio 58: `claveActual` equivocada con `claveNueva` igual al DNI propio, a otro DNI y a otro texto → mismo
        400 `CLAVE_ACTUAL_INCORRECTA` y contador +1; `claveActual` correcta con `claveNueva` igual al DNI → 400
        `SOLICITUD_INVALIDA` en `claveNueva` sin contar; cinco fallos con DNIs distintos → el 5.º 423.
      Si la espera con `pg_blocking_pids` no ve a la API, avisar al orquestador (plan, "Riesgos") (criterios 55 a 58)
- [x] T17.12 · tester · Confirmar que T17.11 falla por la razón esperada: 55, 409 `USUARIO_YA_ACTIVO` en lugar de
      `OPERACION_SOBRE_SI_MISMO`; 56, en crear, desactivar, reactivar y restablecer la petición no espera el bloqueo y
      responde 200 o 201 (y en el control (vi), no espera); 58, 400 `SOLICITUD_INVALIDA` sin contar el intento. Pueden
      pasar ya, y no es un error: 56 (iv) (cambio de clave propia) y, según el orden de llegada, el 57 (si en ninguna
      ronda las dos peticiones se cruzan). Que ninguna falle por sintaxis, importaciones, la conexión propia de la
      prueba o el límite de seguridad sin causa. Commit del orquestador: "Pruebas protegidas (002): ataque ronda 2 (en
      rojo)" (criterios 55 a 58)
- [x] T17.13 · backend · R2-F1: función reutilizable que bloquea y comprueba al actor (y al objetivo, en una sola
      sentencia ordenada por `id`), usada por crear, desactivar, reactivar y restablecer (transacción 2); reactivar sobre
      sí mismo, 409; la versión del token llega al servicio (plan, sección 10.1), sin tocar las pruebas protegidas
      (criterios 55 a 57; 14, 16, 30 a 32, 35)
- [x] T17.14 · backend · Observación 2: en `cambiarClave`, comparar con el DNI y con la actual después de verificar
      `claveActual` (plan, sección 10.3), sin tocar las pruebas protegidas (criterios 23, 24, 58)
- [x] T17.15 · frontend · Observación 1: sesión al recuperar el foco, comprobación antes de cada mutación, caché vacía y
      `/panel` con aviso si cambió la identidad (plan, sección 10.4), con su prueba de componentes (no protegida); sin
      tocar las pruebas de componentes existentes salvo para sumar casos (criterio 59)
- [x] T17.16 · orquestador · `git diff` de los commits de T17.13 a T17.15: ninguno toca pruebas protegidas (de 001 ni
      de 002); suite, lint y tipos en verde (criterios 1 a 59)
- [x] T17.17 · adversarial · Ronda 3, con la spec y el código: carreras entre desactivar, restablecer, cerrar sesión o
      cambiar la clave y las escrituras en curso del mismo actor (también dos pestañas del mismo usuario), interbloqueos
      con varias filas, el orden de los errores (401 frente a 404 y 409), el cambio de clave con DNIs candidatos, y la
      web con dos pestañas y dos academias (criterio 59). Si encuentra fallas, se repite el ciclo (criterios 55 a 59 y
      toda la ruta crítica) _(Hecha el 13/11/2026 sobre 54c9da0: las correcciones de la ronda 2 aguantan; dos fallas,
      F1 y F2, y dos observaciones; se siguen en "Ataque ronda 3".)_
- [x] T17.18 · orquestador · Decidir T5 (¿"actor vigente dentro de la transacción" como regla para las historias
      siguientes?). No bloquea; si se acepta, T20 lo documenta en `docs/arquitectura.md` _(Ataque ronda 4: aceptada,
      DT-5: regla general para toda escritura de usuarios de academia, con `bloquearActorVigente` de
      `backend/src/modulos/autenticacion/actor-vigente.ts`; la documenta T20.)_
- [ ] T17.19 · adversarial (con el orquestador) · Cuando se elija el hosting (D-21), volver a medir los tiempos del
      criterio 53 allí (y, si se puede, en Docker Desktop en Windows) con la misma reproducción de 300 rondas pareadas y
      los umbrales del criterio 53; si no los cumple, el orquestador decide entre igualar la escritura y aceptarlo. No
      bloquea el cierre de 002: el orquestador la anota en el backlog junto a la revisión de DT-1 (criterio 53)

### Ataque ronda 3 (13/11/2026, sobre 54c9da0)

Las correcciones de la ronda 2 aguantan. F1 (media, ruta crítica): el fallo de la `claveActual` en
`POST /api/sesion/clave` se cuenta con la sesión ya revocada (criterio 60). F2 (media, web): la web envía la acción si
la misma persona vuelve con el cambio obligatorio pendiente (criterio 61, no crítico). Observaciones: escrituras en
curso al suspender la academia (riesgo aceptado) y el Superadmin dentro de la transacción (nota en N11). Decisiones
AR3-1 a AR3-4 y nota de proceso sobre `b6b2d77` en `spec.md`. T18 en adelante esperan a que la ronda 4 no encuentre
fallas.

- [x] T17.20 · especificador · Criterios 60 y 61 (sección M), notas en los criterios 24, 56, 58 y 59, casos límite,
      contrato, "Riesgos aceptados" (riesgo nuevo "Escrituras en curso al suspender la academia"), decisiones AR3-1 a
      AR3-4, nota de proceso sobre `b6b2d77`, notas en N11 y T5; plan, sección 11 (criterios 60, 61)
- [x] T17.21 · test-writer · Prueba protegida de integración del criterio 60, en rojo, desde la spec y sin mirar la
      implementación, con `conFilaRetenida`: (i) `desactivar` y (ii) `solo-version`, con `COMMIT` y con 0 y 4 fallos
      previos → la petición esperó el bloqueo, 401 `NO_AUTENTICADO`, contador igual al previo, `bloqueado_hasta` nulo,
      `clave_hash` igual y sin auditoría nueva (en (i), X `INACTIVO` con la versión que dejó la prueba); (iii) control
      `bloquear-sin-cambiar` con `ROLLBACK` → 400 y contador 1 con 0 previos, 423 con contador 5 y `bloqueado_hasta`
      futuro con 4 previos; (iv), opcional, `solo-cambio-pendiente` con `COMMIT` → 400 y contador 1. Un X nuevo por
      caso. Si la espera con `pg_blocking_pids` no ve a la API, avisar al orquestador (criterio 60)
- [x] T17.22 · tester · Confirmar que T17.21 falla por la razón esperada: en (i) y (ii), 400
      `CLAVE_ACTUAL_INCORRECTA` o 423 en lugar de 401, con el contador + 1 (y, con 4 previos, `bloqueado_hasta`
      fijado). Pueden pasar ya, y no es un error: (iii) y (iv). Que ninguna falle por sintaxis, importaciones o el límite
      de seguridad sin causa. Antes del commit, `git diff --cached --stat` debe mostrar solo archivos de prueba (nota de
      proceso sobre `b6b2d77`, `spec.md`). Commit del orquestador: "Pruebas protegidas (002): ataque ronda 3 (en rojo)"
      (criterio 60)
- [x] T17.23 · backend · F1: separar el conteo en una función que recibe la transacción, sin cambiar el del ingreso, y
      contar el fallo del cambio de clave en una transacción que antes llama a `bloquearActorVigente(…, {
      permitirCambioPendiente: true, exclusivo: true })` (plan, sección 11.1), sin tocar las pruebas protegidas; la del
      criterio 53 debe seguir en verde (criterios 24, 53, 56, 58, 60)
- [x] T17.24 · frontend · F2: `useConfirmarSesion` también rechaza, sin enviar la acción, la sesión con el cambio
      obligatorio pendiente, con la opción `permitirCambioPendiente` en `useCambiarClave` (plan, sección 11.2), con su
      prueba de componentes (no protegida): "Crear usuario" con la misma identidad y `debeCambiarClave: true` no envía
      `POST /api/usuarios` y lleva a `/cambiar-clave`; en `/cambiar-clave` el formulario sí envía
      `POST /api/sesion/clave` (control). Sin tocar las pruebas de componentes existentes salvo para sumar casos
      (criterios 59, 61)
- [x] T17.25 · orquestador · `git diff` de los commits de T17.23 y T17.24: ninguno toca pruebas protegidas (de 001 ni
      de 002); suite, lint y tipos en verde (criterios 1 a 61)
- [x] T17.26 · adversarial · Ronda 4, con la spec y el código: el conteo del fallo del cambio de clave frente a
      desactivar, restablecer, cerrar sesión y otro cambio de clave en curso (también con 4 fallos previos y fallos
      simultáneos de la misma sesión, sin `40P01`); que el ingreso siga con la misma secuencia del criterio 53 y los
      tiempos de la ronda 2; otras escrituras laterales de una sesión revocada; y la web con la misma identidad y el
      cambio obligatorio en otra pestaña (criterio 61). Si encuentra fallas, se repite el ciclo (criterios 60, 61 y
      toda la ruta crítica) _(Hecha el 13/11/2026 sobre 115cf7f: sin fallas; se sigue en "Ataque ronda 4".)_

### Ataque ronda 4 (13/11/2026, sobre 115cf7f): sin fallas

Sin fallas reproducibles con impacto: termina el ciclo adversarial. Probado: los seis casos del criterio 60 y el 61;
aislamiento entre academias; 19 variantes de ruta y método por rol; sesión y versión de token; concurrencia `c2` con
8, 32 y 64 hilos, sin inanición, y revisión de ciclos; DNI con espacios Unicode; registro técnico con 14 cuerpos rotos
en nivel `trace`, sin DNI ni claves; la web. Dos observaciones quedan como riesgos aceptados (AR4-1, "Bloqueo
provocado por terceros" ampliado; AR4-2, dentro de "Ingresar mientras otro dispositivo cierra la sesión") y el
orquestador decidió T4 (DT-4) y T5 (DT-5). No hay criterios nuevos ni pruebas protegidas nuevas. Solo queda abierta N11
(Bryan, T17.8), con el valor provisional (a), sin bloquear.

**Siguen:** la revisión (T18), la suite completa con lint y tipos (T19) y la documentación con el commit final (T20).

- [x] T17.27 · especificador · Ronda 4 sin fallas en `spec.md` (estado, "Ataque ronda 4 y decisiones del orquestador"
      con AR4-1, AR4-2, DT-4 y DT-5, nota en el criterio 10, casos límite, "Impacto", "Riesgos aceptados" y "Preguntas
      abiertas"); plan, sección 12, "Decisiones" y "Riesgos"; estas tareas
- [ ] T17.28 · orquestador · Notas en `specs/backlog.md`: alinear `DELETE /api/plataforma/sesion` con el criterio 54
      en una historia propia (DT-4), y volver a medir los tiempos del criterio 53 en el hosting junto a la revisión de
      DT-1 (T17.19). No bloquea T18 ni T19

- [ ] T18 · revisor · Comparar con la spec y las convenciones (`CLAUDE.md` y "Reglas para las historias siguientes" de
      `docs/arquitectura.md`); confirmar con `git diff` que ningún commit de implementación tocó pruebas protegidas.
      _(Ataque ronda 3:)_ el commit de pruebas `b6b2d77` trae también `usuarios.service.ts`; es el caso registrado en la
      nota de proceso de `spec.md` ("Decisiones"), no una violación
- [ ] T19 · tester · Suite completa, lint y verificación de tipos (Linux; la CI también en Windows)
- [ ] T20 · documentador · Commit final, tareas marcadas, `README.md`, `docs/guia-local-windows.md` (criterio 52) y
      `docs/arquitectura.md` (sesión de academia, matriz de permisos, `@Permiso` y `@SoloSesion` para las historias
      siguientes). _(Ataque ronda 2:)_ si el orquestador acepta T5, también la regla "actor vigente dentro de la
      transacción que escribe" y la función reutilizable de la sección 10.1 del plan. _(Ataque ronda 3:)_ con la
      precisión de la nota de T5: la regla vale para toda transacción que escribe, también un contador en la propia
      fila (criterio 60). _(Ataque ronda 4, DT-5:)_ T5 aceptada: documentar en "Reglas para las historias siguientes"
      que toda escritura a pedido de un usuario de academia llama a `bloquearActorVigente`
      (`backend/src/modulos/autenticacion/actor-vigente.ts`) dentro de su transacción, con el orden por `id` cuando
      bloquea dos filas de `usuarios` y el modo exclusivo cuando escribe la fila del actor (plan, secciones 10.1, 11.1 y
      12). Marcar también T1 a T16 si el historial lo confirma

## Solo ruta crítica

- [x] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación _(verde en cada ronda, T17.6, T17.16 y T17.25; se marca con la suite
      completa de T19)_
- [x] Ataque adversarial sin fallas abiertas _(ronda 4, 13/11/2026)_
