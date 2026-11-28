# 011 · Plan técnico

Una sola entrega, de ruta crítica, sobre la 010 completa en `main`. Una migración pequeña (un índice único). Dos rutas de
solo lectura nuevas y la página del alumno en `/panel`.

**Estado:** borrador (28/11/2026), pendiente de las respuestas de Bryan a P1 a P5 y de que el orquestador acepte DT-1 a
DT-16.

## Módulos afectados

- `backend/prisma/schema.prisma` y la migración `<marca>_panel_alumno` (criterio 1).
- `backend/src/modulos/panel-alumno/` (nuevo, DT-9):
  - `mi-panel.controller.ts`: `@Controller('mi-panel')`, `@Get()` con `@Permiso('VER_CARNET')` y `@Get('asistencias')`
    con `@Permiso('VER_REPORTES_ASISTENCIA')`, los dos con `@Header('Cache-Control', 'no-store')`;
  - `alcance.ts`: `exigirAlcancePropio(sesion, permiso)`, la misma forma que `exigirAlcanceDelCarnet` (DT-2);
  - `mi-panel.service.ts`: `resumen(academiaId, usuarioId)` (criterios 2, 6 a 11);
  - `dominio/mensualidad-del-panel.ts`: funciones puras `elegirMensualidades` (estado, `actual`, `siguiente`) y
    `mesesDeAsistencia`, con sus pruebas unitarias;
  - `panel-alumno.module.ts`, registrado en `app.module.ts`.
- `backend/src/modulos/asistencia/consulta.service.ts`: `delMesDelUsuario(academiaId, usuarioId, mes)` junto a `delMes`,
  las dos sobre una función privada común (DT-5); se exporta en `asistencia/index.ts`.
- `backend/src/modulos/mensualidades/`: `lectura-de-estado.ts` (nuevo) con `leerMensualidadesParaEstado(tx, meses,
  alumnoId)` y `agruparPorMes(filas)`, sacadas de `listado.service.ts`, que pasa a usarlas sin cambiar su respuesta
  (DT-4); se exportan en `mensualidades/index.ts` junto a `estadoDeMensualidad`.
- `backend/src/modulos/caja/head-sin-ruta.ts`: `'/mi-panel'` en `PREFIJOS_SIN_HEAD` (criterio 16).
- `packages/contratos/src/panel-alumno.ts` (nuevo) con `miPanelSchema`, `mensualidadDelPanelSchema` y
  `siguienteDelPanelSchema`; `edadEnFecha` en `packages/contratos/src/inscripcion.ts`; exportados en `index.ts`
  (criterio 17).
- `frontend/src/modulos/panel-alumno/` (nuevo): `PanelDelAlumno.tsx`, `MiAsistencia.tsx`, `api.ts`, `hooks.ts`,
  `etiquetas.ts` y `PanelDelAlumno.test.tsx`.
- `frontend/src/modulos/asistencia/ListaDeAsistencia.tsx` (nuevo): la lista y los totales, sacados de
  `alumnos/AsistenciaDelMes.tsx`, que pasa a usarlos (DT-10).
- `frontend/src/modulos/panel/PaginaPanel.tsx`: monta `PanelDelAlumno` para el alcance `PROPIO` de `VER_CARNET`.
- `e2e/pruebas/panel-alumno.spec.ts` (criterio 20) y lo que necesite de `e2e/datos-e2e.ts`.
- `docs/arquitectura.md`, `docs/guia-local-windows.md` y `specs/backlog.md` (criterio 21, documentador).

## Diseño

### Alumno de la sesión (criterios 1 y 2)

El controlador no declara `@Param`, `@Query` (salvo `mes`) ni `@Body`. Toma `@SesionActual()` y llama a
`exigirAlcancePropio(sesion, permiso)` antes de cualquier lectura; después, el servicio recibe solo
`sesion.usuario.academiaId` y `sesion.usuario.id`. La primera sentencia de la transacción es:

```sql
SELECT id::text AS id, ... FROM alumnos
 WHERE academia_id = ${tx.academiaId}::uuid AND usuario_id = ${usuarioId}::uuid AND estado <> 'CLIENTE'
```

Cero filas: 404 `alumnoNoEncontrado()` (el de la 008). Más de una: `Error` interno (500 sin datos; el índice del
criterio 1 lo impide). El id del alumno que devuelve esa sentencia es el único que usan las sentencias siguientes, y no
sale en la respuesta (DT-6).

### Resumen (criterios 6 a 11)

`MiPanelService.resumen` en un solo `conAcademia`, sin bloqueos:

1. el alumno de la sesión (con `nombres`, `apellidos`, `dni`, `nivel`, `estado` y `fecha_nacimiento` como texto
   `AAAA-MM-DD`);
2. `leerConfiguracion(tx)` para `diasPorVencer`;
3. `leerMensualidadesParaEstado(tx, [M−1, M, M+1], alumno.id)`: la misma sentencia del listado (pagadas y en verificación
   de alumnos `ALUMNO_ACTIVO` o `ALUMNO_VENCIDO`, con plan y clases). Un `INACTIVO` no devuelve filas y queda sin estado
   (provisional de P4);
4. los meses con mensualidad pagada no posteriores a M: `SELECT DISTINCT anio, mes FROM matriculas WHERE academia_id = …
   AND alumno_id = … AND estado IN ('VIGENTE', 'FINALIZADA') AND anio * 12 + mes - 1 <= índice(M)`.

Fuera de la base: `hoy = hoyEnLima(RELOJ.ahora())` (tomado una vez, antes de abrir la transacción), `edadEnFecha`,
`elegirMensualidades` (que llama a `estadoDeMensualidad` y elige `actual` y `siguiente` con las reglas del listado) y
`mesesDeAsistencia` (M más los meses del paso 4, sin repetir, del más nuevo al más viejo). La respuesta se valida con
`miPanelSchema.parse`: si sobrara una clave, falla en lugar de filtrarla (como el carnet).

Las clases de `actual` y `siguiente` se mapean a `{ diaSemana, horaInicio, horaFin }`, sin el `id` que trae la lectura
del listado.

### Asistencia (criterios 12 y 13)

`ConsultaDeAsistenciaService` queda así:

- `delMes(academiaId, alumnoId, mes)` (009b, sin cambios de comportamiento): comprueba el UUID, abre `conAcademia`, busca
  al alumno por id y llama a `leerDelMes(tx, alumnoId, anio, mes)`;
- `delMesDelUsuario(academiaId, usuarioId, mes)` (011): abre `conAcademia`, busca al alumno de la sesión (la sentencia de
  arriba) y llama a la misma `leerDelMes`.

`leerDelMes` es el cuerpo actual (matrícula del mes, asistencias, faltas sin cubrir, orden y `asistenciaDelMesSchema`).
El controlador del panel valida `mes` con el valor crudo (`parametroCrudo`, como 009b) y `mesDeAsistenciaSchema`, y
además rechaza un mes posterior a M con 400 `SOLICITUD_INVALIDA` (campo `mes`), con M de `hoyEnLima(RELOJ.ahora())`.

### Solo lectura (criterios 14 y 15)

Las dos rutas son `GET`; no hay manejadores de otros métodos en `/mi-panel`, así que Nest responde 404.

La prueba del inventario (criterio 15) arma la aplicación real de las pruebas de integración y recorre los
controladores con `DiscoveryService` y `MetadataScanner` de `@nestjs/core`: por cada manejador lee la ruta
(`PATH_METADATA` del controlador y del método), el método HTTP (`METHOD_METADATA`) y la metadata de
`CLAVE_PERMISO` y `CLAVE_SOLO_SESION`. Deja fuera `GET`, `/a/…`, `/plataforma/…`, `/salud` y `DELETE /sesion`. Un
manejador «deja pasar al alumno» si tiene `CLAVE_SOLO_SESION` o si `puede('ALUMNO', permiso)`. La lista esperada es
exactamente la del criterio 15; si la prueba encuentra otro manejador que deja pasar al alumno, el test-writer para y
avisa al orquestador (puede ser una ruta que la spec no conoce). Después pide cada ruta restante con la sesión de un
alumno y compara, como dueño, el contenido de las tablas del criterio 14 antes y después
(`md5(string_agg(t::text, '|' ORDER BY t::text))` por tabla). No se pide `POST /api/sesion/clave`.

### Web (criterios 18 y 19)

`PaginaPanel` decide con `alcanceDe(usuario.rol, 'VER_CARNET') === 'PROPIO'` si monta `PanelDelAlumno` arriba de las
tarjetas (que para el alumno siguen siendo «Mi carnet»). `useMiPanel()` y `useMiAsistencia(mes)` usan claves con la
identidad de la sesión, como las demás consultas. `MiAsistencia` recibe `mesesDeAsistencia` y `mesEnCurso` del resumen y
no usa `mesActualEnLima()` ni `hoyEnLima()` de `lib/fechas` (DT-7). La lista y los totales vienen de
`ListaDeAsistencia`, la misma que usa la ficha de recepción.

## Decisiones

Cada DT la acepta el orquestador (decisiones técnicas menores, D-31).

| # | Decisión | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| DT-1 | Rutas sin id: `GET /api/mi-panel` y `GET /api/mi-panel/asistencias`, como `/api/mi-carnet`. | `GET /api/alumnos/{id}/…` con alcance `PROPIO`, comparando el id con el de la sesión. | Sin id no hay nada que cambiar en la dirección (D-14, «aislamiento entre alumnos»), y la ruta del personal y sus pruebas protegidas de la 009 no cambian. |
| DT-2 | Se reutilizan `VER_CARNET` (resumen) y `VER_REPORTES_ASISTENCIA` (asistencia), los dos con alcance `PROPIO`, que hoy son solo del `ALUMNO`. | Un permiso nuevo `VER_PANEL_PROPIO`. | La sección 2.1 ya da al alumno «ver carnet» (plan, horario, vigencia, nivel, DNI) y «asistencia propia». Un permiso nuevo cambia la prueba protegida de la matriz de la 002 (`permisos.test.ts`, 26 filas exactas) y pediría la aprobación de Bryan. |
| DT-3 | Índice único `alumnos (academia_id, usuario_id)` y falla cerrada si la sentencia devuelve dos filas. | Confiar en que la 007 crea una cuenta por alumno. | El rol de la app tiene `UPDATE (usuario_id)` en `alumnos`; un error futuro podría unir una cuenta a dos alumnos y el panel mostraría a otro. La base lo impide para siempre. |
| DT-4 | La lectura de mensualidades del listado (`leerMatriculas` y la agrupación por mes) se saca a `mensualidades/lectura-de-estado.ts` y la usan el listado y el panel. | Una consulta propia del panel. | El criterio 10 exige el mismo estado que ve recepción; con una sola lectura no pueden separarse. El listado no cambia su respuesta. |
| DT-5 | La asistencia del panel reutiliza `ConsultaDeAsistenciaService` y `asistenciaDelMesSchema` sin cambios. | Un esquema propio con totales calculados en la API. | El criterio 12 pide el mismo cuerpo que recepción; los totales ya los cuenta la web de 009b desde los registros. |
| DT-6 | La respuesta del panel no lleva ningún id. | Devolver `alumno.id` para reutilizar los ganchos de la ficha. | La web del alumno no lo necesita, y sin id no hay tentación de armar rutas `/alumnos/{id}` desde el panel. |
| DT-7 | `hoy`, `mesEnCurso` y `mesesDeAsistencia` salen de la API. | `mesActualEnLima()` del navegador. | Es la deuda de la 010a y la 010b (el reloj del navegador elige el mes); el panel no la repite. |
| DT-8 | `Cache-Control: no-store` en las respuestas 200 del panel. | Sin cabecera, como las demás lecturas JSON. | Datos de menores en un celular que puede ser de la familia: que no queden en la caché del navegador ni de un proxy. |
| DT-9 | Módulo nuevo `panel-alumno`, que importa de `alumnos`, `asistencia`, `mensualidades` y `configuracion`; nadie lo importa. | Ponerlo dentro de `alumnos`. | `mensualidades` y `asistencia` ya importan de `alumnos`; meter el panel ahí formaría un ciclo. |
| DT-10 | `ListaDeAsistencia` (lista y totales) se comparte entre la ficha de recepción y el panel. | Copiar el marcado de `AsistenciaDelMes.tsx`. | Misma presentación de «Puntual», «Tarde» y «Falta» en las dos pantallas, sin duplicar. |
| DT-11 | El carnet y el QR siguen en `/panel/mi-carnet`; el panel enlaza «Mi carnet». | Mostrar el QR en el inicio del panel. | Lo construyó y lo aprobó la 008 (criterio 20); el resumen no relee la foto ni el QR. |
| DT-12 | Sin foto en el resumen. | La foto como `data:` JPEG, como el carnet. | Otra lectura del almacén por cada visita al inicio, sin que HU-06 la pida; la foto está en «Mi carnet». |
| DT-13 | La prueba del inventario de escrituras (criterio 15) recorre los manejadores con la metadata de Nest y luego los pide por HTTP. | Confiar en la matriz y en las pruebas de cada historia. | D-14 es una regla de todo el sistema; una escritura nueva que deje pasar al alumno debe romper una prueba protegida. |
| DT-14 | `edadEnFecha` vive en `packages/contratos` junto a `esMenorDeEdad`, con la misma regla del 29 de febrero. | Calcular la edad en la web desde la fecha de nacimiento. | La fecha de nacimiento no sale de la API (P1) y la edad se calcula con el hoy de Lima del servidor. |
| DT-15 | Sin límite de peticiones propio. | Un límite por usuario en estas rutas. | Es el pendiente general de la API con sesión (DT-14 de 006), que se decide con el hosting. |
| DT-16 | Marca de las pruebas protegidas: `// spec: 011-panel-alumno (pruebas protegidas)` y commits «Pruebas protegidas (011): …». | — | Tres dígitos sin letra: el verificador la reconoce (deuda (a) de la 010d). |

## Migraciones

- `<marca>_panel_alumno`: `CREATE UNIQUE INDEX "alumnos_academia_id_usuario_id_key" ON "alumnos" ("academia_id",
  "usuario_id");`. Los `NULL` son distintos entre sí (los clientes no chocan). Si una base tuviera dos alumnos con la
  misma cuenta, la migración falla: no hay datos reales (repositorio público, D-26) y en desarrollo no puede pasar.
- Sin cambios de privilegios (`PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` no cambian) ni de políticas.

## Riesgos

- **Reorganizar código con pruebas protegidas (DT-4, DT-5):** `listado.service.ts` y `consulta.service.ts` tienen
  pruebas protegidas de la 009b y la 010b. El backend corre esas pruebas por archivo después del cambio
  (`backend/test/integracion/mensualidades/listado-*.test.ts` y `asistencia/consulta-mes*.test.ts`); no se tocan.
- **Inventario frágil (DT-13):** si la metadata de Nest cambia de clave en una versión futura, la prueba debe fallar por
  «no encontró manejadores», no pasar vacía: la prueba exige un mínimo de manejadores encontrados (al menos los `POST` de
  caja, pagos, asistencia y mensualidades que existen hoy).
- **R1-1 de la 008a (deuda):** un cuerpo mal formado responde 400 antes del 403 en algunas rutas; por eso el criterio 15
  acepta cualquier 4xx y exige solo que no haya 2xx ni escrituras.
- **Prueba de E2E con dos cuentas:** necesita dos alumnos hermanos confirmados en los datos de E2E; si `datos-e2e.ts` no
  los tiene, se agregan con datos inventados.
