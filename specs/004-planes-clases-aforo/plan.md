# 004 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes") y las specs [`001`](../001-academias-aislamiento/spec.md),
[`002`](../002-autenticacion-roles/spec.md) y [`003`](../003-configuracion-academia/spec.md). Lo que no es orientativo
es el contrato de `spec.md`.

**Estado:** aprobado con la spec (17/11/2026). Bryan aceptó las propuestas de N1 a N8 (DR-1 a DR-8 de 004) y el
orquestador las de T1 a T5 (DT-1 a DT-5 de 004); el diseño no cambia. Los límites de N1, la clase única por nivel y
bloque de N3 y los campos inmutables de N4 quedan como están en este plan. Si algún día se revisan, cambian los
esquemas, un índice único y los privilegios de `clases` (con otra migración); el resto del diseño no.

## Módulos afectados

```
piscina/
├── packages/contratos/src/
│   ├── horario.ts (+ .test.ts)          nuevo: niveles, días, bloques, fechas AAAA-MM-DD
│   ├── dinero.ts (+ .test.ts)           nuevo: montoSchema (texto con hasta dos decimales)
│   ├── planes.ts (+ .test.ts)           nuevo: esquemas de planes y respuestas
│   ├── clases.ts (+ .test.ts)           nuevo: esquemas de clases y respuestas
│   └── index.ts                         + exportaciones
├── backend/
│   ├── package.json                     + date-fns y @date-fns/tz (D-25)
│   ├── prisma/schema.prisma             + NivelNatacion, Plan, Clase
│   ├── prisma/migrations/<marca>_planes_clases/   tablas, CHECK, índices, RLS y privilegios
│   ├── prisma/seed.ts                   + segundo entrenador, planes y clases de delfines (criterio 30)
│   ├── src/infraestructura/prisma/privilegios-app.ts   + privilegios de planes y clases (criterio 2)
│   ├── src/comun/fechas/lima.ts (+ .test.ts)      hoyEnLima(instante) → 'AAAA-MM-DD'
│   ├── src/comun/dinero/ (+ .test.ts)   Decimal ⇄ texto con dos decimales
│   ├── src/app.module.ts                + PlanesModule, ClasesModule
│   ├── src/modulos/planes/              nuevo
│   │   ├── dominio/plan.ts (+ .test.ts) normalizar, reglas cruzadas, cambios pedidos, estadoDelPlan
│   │   ├── planes.service.ts · planes.controller.ts · planes.module.ts · index.ts
│   ├── src/modulos/clases/              nuevo
│   │   ├── dominio/clase.ts (+ .test.ts) horaFin, cambios pedidos, orden de la lista
│   │   ├── cupo.ts                      bloquearClasesParaCupo(tx, ids), sin Nest (criterio 23)
│   │   ├── clases.service.ts · clases.controller.ts · clases.module.ts · index.ts
│   └── test/
│       ├── utilidades/planes-clases.ts  crear planes, clases y entrenadores; escribir filas como dueño (test-writer)
│       └── integracion/planes/ · integracion/clases/   pruebas protegidas y no protegidas
├── scripts/
│   ├── lib/rol-app.mjs                  + privilegios de planes y clases (misma lista que PRIVILEGIOS_APP)
│   └── test/integracion/migraciones.test.mjs   + planes y clases en TABLAS_DESPUES_DE_MIGRAR (no protegida)
├── frontend/src/
│   ├── modulos/planes/api.ts · hooks.ts · PaginaPlanes.tsx · FormularioPlan.tsx · Planes.test.tsx
│   ├── modulos/clases/api.ts · hooks.ts · PaginaClases.tsx · GrillaSemanal.tsx · FormularioClase.tsx · Clases.test.tsx
│   ├── modulos/panel/PaginaPanel.tsx    + "Planes" y "Clases y horarios"; clave de React por ruta
│   ├── lib/dinero.ts                    formato "S/ 120.00" desde el texto de la API, sin pasar por number
│   └── rutas/Rutas.tsx                  + /panel/planes y /panel/clases
└── docs/arquitectura.md · README.md · guía de uso   documentador (criterio 31)
```

## Diseño

### 1. Contratos

- `horario.ts`: `NIVELES = ['BASICO', 'INTERMEDIO', 'AVANZADO'] as const` y `nivelNatacionSchema`; `DIAS_SEMANA` (1 a
  7, con `NOMBRE_DIA`) y `diaSemanaSchema` (`z.number().int().min(1).max(7)`); `BLOQUES = ['08:00', …, '19:00']` y
  `horaBloqueSchema = z.enum(BLOQUES)` (así `"8:00"`, `"08:30"` y `"08:00:00"` no pasan); `horaFinDe(bloque)`;
  `fechaSchema` (`^\d{4}-\d{2}-\d{2}$` y comprobación de fecha real con `Date.UTC`, sin zona).
- `dinero.ts`: `montoSchema = z.string().regex(/^(0|[1-9]\d{0,4})(\.\d{1,2})?$/)` con un `refine` "mayor que 0"
  hecho sobre el texto (sin `Number`): rechaza `"0"`, `"0.0"` y `"0.00"`. Sin `trim` (un espacio es 400, criterio 10).
- `planes.ts`: `crearPlanSchema` estricto; los arreglos con `refine` de "sin repetidos" y "no vacío"; el `superRefine`
  de las reglas cruzadas (`diasPermitidos.length >= vecesPorSemana`, fin ≥ inicio comparando los textos
  `AAAA-MM-DD`) pone el error en `diasPermitidos` o `vigenciaFin`. `actualizarPlanSchema` estricto con todo opcional y
  un `refine` "al menos un campo"; las reglas cruzadas del `PATCH` las aplica el dominio con lo guardado (sección 3).
  Límites exportados (`LIMITES_PLAN`) para la web.
- `clases.ts`: `AFORO_MINIMO = 20`, `AFORO_MAXIMO = 50`; `crearClaseSchema` y `actualizarClaseSchema` estrictos;
  `entrenadorId: z.uuid()`.

### 2. Migración `<marca>_planes_clases`

Como la de `usuarios` (002): comprobación de que existe `aquagestion_app`; `CREATE TYPE nivel_natacion`; las dos tablas
con sus `CHECK` (criterio 4) y llaves; los índices únicos parciales de clases y el de `lower(nombre)` de planes; `ENABLE`
y `FORCE ROW LEVEL SECURITY`; políticas `planes_leer`, `planes_crear`, `planes_modificar` (y las de `clases`) con la
forma exacta de `usuarios`; `GRANT SELECT, INSERT` y `GRANT UPDATE (columnas…)` del criterio 2.

`CHECK` de arreglos sin funciones propias (para no sumar objetos que la comprobación del rol tenga que conocer):

- `cardinality(dias_permitidos) >= veces_por_semana AND dias_permitidos <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`;
- `cardinality(franjas_permitidas) >= 1 AND franjas_permitidas <@ ARRAY['08:00', …, '19:00']::time[]`;
- `cardinality(niveles_aplicables) >= 1`;
- `hora_inicio = ANY (ARRAY['08:00', …, '19:00']::time[])` y `hora_fin = hora_inicio + interval '1 hour'`;
- `vigencia_fin IS NULL OR vigencia_inicio IS NULL OR vigencia_fin >= vigencia_inicio`.

`<@` con un arreglo vacío es verdadero, por eso cada uno va con su `cardinality`. Un `NULL` dentro del arreglo: añadir
`array_position(col, NULL) IS NULL` en los tres arreglos.

Ampliar en el mismo cambio `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` (la prueba que compara las dos listas falla si
no) y `TABLAS_DESPUES_DE_MIGRAR`.

### 3. Dominio (funciones puras)

- `planes/dominio/plan.ts`:
  - `normalizarPlan(entrada)`: ordena días y franjas, niveles en el orden de `NIVELES`.
  - `planCombinado(guardado, pedido)` y `validarReglasCruzadas(combinado)` → lista de `{ campo, mensaje }` (criterio
    12).
  - `cambiosPedidosPlan(guardado, pedido)` → campos que cambian, con antes y después en el formato de la API. El precio
    se compara como `Decimal` (`"120"` y `"120.00"` son iguales); los arreglos, ya normalizados.
  - `estadoDelPlan({ activo, vigenciaInicio, vigenciaFin }, hoy)` con `hoy` en `AAAA-MM-DD` (criterio 14).
- `clases/dominio/clase.ts`: `cambiosPedidosClase`, `ordenDeClases` (día, hora, nivel por su posición en `NIVELES`,
  id).
- `comun/fechas/lima.ts`: `hoyEnLima(instante: Date): string` con `TZDate` de `@date-fns/tz` y `format` de `date-fns`
  (`yyyy-MM-dd`). Pruebas unitarias en 04:59:59Z y 05:00:00Z, fin de mes y de año, y con `process.env.TZ` distinto.
- `comun/dinero`: `aTextoMonto(decimal)` → `toFixed(2)` de `Decimal` (nunca `Number`), `aDecimal(texto)`.

### 4. Lectura de planes y clases

- `GET /api/planes`: `conAcademia` + `SELECT … FROM planes WHERE academia_id = tx.academiaId`; `estado` con
  `hoyEnLima(RELOJ.ahora())`; orden con `Intl.Collator('es')` en el código (como `ordenarPorNombre` de usuarios).
  `precio::text` en la consulta y `aTextoMonto` al responder, para no pasar por `number`.
- `GET /api/clases`: una sola consulta con `JOIN usuarios u ON u.academia_id = c.academia_id AND u.id = c.entrenador_id`
  (solo `id`, `nombres`, `apellidos`, `estado`; nunca el DNI); `hora_inicio::text` recortado a `HH:MM`; orden con
  `ordenDeClases`.

### 5. Escrituras de planes

Cada una en un `conAcademia(academia de la sesión, …)`:

1. `bloquearActorVigente(tx, { id, versionToken }, { registro, ip })` (`FOR SHARE`), primera sentencia (criterio 7).
2. **`POST`:** `INSERT … ON CONFLICT DO NOTHING RETURNING …` (el índice de `lower(nombre)` decide el 409, también con dos
   creaciones simultáneas, criterio 11); sin fila → 409 `NOMBRE_PLAN_EN_USO`. El nombre se guarda tal como llega,
   recortado; la unicidad compara `lower(nombre)`.
3. **`PATCH`:** `SELECT … FROM planes WHERE academia_id = … AND id = … FOR UPDATE` (sin fila → 404); combinar y validar
   (400); `cambiosPedidosPlan`; sin cambios → devolver sin escribir; si cambia el nombre, el `UPDATE` puede chocar con
   el índice único: se usa `UPDATE … WHERE NOT EXISTS (SELECT 1 FROM planes WHERE academia_id = … AND lower(nombre) =
   lower(nuevo) AND id <> …)` y, si no actualiza, 409. Si de todas formas salta `23505` (carrera con un `INSERT`), la
   transacción aborta y se responde 409 tras el `ROLLBACK`: se distingue por el nombre de la restricción en
   `errorParaRegistro`, nunca por el mensaje.
4. `AuditoriaService.registrarEnAcademia` con `PLAN_CREADO` o `PLAN_ACTUALIZADO` (solo los campos cambiados).

El `FOR UPDATE` de la fila del plan ordena dos `PATCH` simultáneos y encadena sus auditorías (criterio 12).

### 6. Escrituras de clases y bloqueo del cupo

`cupo.ts`:

```sql
SELECT id::text, nivel::text, dia_semana, to_char(hora_inicio, 'HH24:MI'), to_char(hora_fin, 'HH24:MI'),
       aforo, activo, entrenador_id::text
  FROM clases
 WHERE academia_id = ${tx.academiaId}::uuid AND id = ANY(${ids}::uuid[])
 ORDER BY id FOR UPDATE
```

Con `ids` sin repetidos, en minúsculas, solo UUID válidos; con la lista vacía, devuelve `[]` sin consultar.

**`POST /api/clases`:**

1. `bloquearActorVigente` (`FOR SHARE`).
2. Entrenador: `SELECT rol, estado FROM usuarios WHERE academia_id = … AND id = …` sin bloqueo (D11); si no es un
   `ENTRENADOR` `ACTIVO`, 409 `ENTRENADOR_NO_VALIDO`.
3. `INSERT INTO clases … ON CONFLICT DO NOTHING RETURNING …`. Sin fila: una consulta mira qué choca (primero una clase
   activa del mismo nivel en el bloque → `CLASE_DUPLICADA`; si no, una del mismo entrenador → `ENTRENADOR_OCUPADO`).
   `ON CONFLICT DO NOTHING` sin destino espera a la transacción que tiene la fila en conflicto, así que la consulta
   posterior ve la fila confirmada (criterio 20 f).
4. Auditoría `CLASE_CREADA`.

**`PATCH /api/clases/{id}`:**

1. `bloquearActorVigente` (`FOR SHARE`).
2. `bloquearClasesParaCupo(tx, [id])`, siempre (criterio 22); sin fila → 404.
3. Si viene `entrenadorId` distinto, o `activo: true` sobre una clase inactiva: comprobar el entrenador (paso 2 del
   `POST`) con el entrenador que quedará.
4. `cambiosPedidosClase`; sin cambios → devolver sin escribir.
5. `UPDATE clases SET … WHERE academia_id = … AND id = …`. Un cambio de entrenador o una reactivación puede chocar con
   los índices parciales (`23505`): la transacción aborta y se responde 409 con el código del índice que chocó
   (identificado por el nombre de la restricción del error, sin su mensaje). Alternativa equivalente: comprobar antes
   con una consulta y dejar el índice como red de seguridad; con la fila de la clase bloqueada, la única carrera
   posible es con otra clase que entra al mismo bloque, que el índice resuelve.
6. Auditoría `CLASE_ACTUALIZADA`.

**Orden de bloqueos:** `usuarios` (actor, `FOR SHARE`) → `clases` (`FOR UPDATE`, ordenadas por id). Las llaves foráneas
toman `FOR KEY SHARE` sobre la fila del entrenador al insertar o cambiar `entrenador_id`; desactivar un usuario (002)
toma `FOR UPDATE` sobre las filas de `usuarios` del actor y del objetivo, nunca sobre `clases`, así que no hay ciclo. El
adversarial lo comprueba (riesgos).

No hay efectos secundarios fuera de la transacción.

### 7. Web

- `modulos/planes` y `modulos/clases`: `api.ts` (llamadas), `hooks.ts` (TanStack Query) y páginas. Claves con la
  identidad de la sesión: `['planes', nombreCorto, usuarioId]` y `['clases', nombreCorto, usuarioId]` (criterio 29;
  criterio 28 de 003).
- Formularios con React Hook Form y los esquemas compartidos. Al editar, la **base de llenado** y `cambiosDe(textos,
  base)` de la 003 (criterio 27 de 003): conviene extraer de `modulos/configuracion` las piezas reutilizables (cálculo
  de cambios, aviso de "otro administrador cambió…") en vez de copiarlas. `<fieldset disabled={mutacion.isPending}>`
  mientras se guarda; `onSuccess` sin devolver ni esperar invalidaciones de otras consultas (criterio 31 a de 003).
- Precio: el campo es texto; se muestra con `lib/dinero.ts`, que da formato al texto de la API sin convertirlo a
  `number`.
- Grilla semanal (`GrillaSemanal`): 7 columnas por 12 filas en pantallas anchas; en el celular, selector de día y una
  lista de bloques. Cada celda muestra hasta tres clases (una por nivel, N3).
- Selector de entrenador: `GET /api/usuarios` filtrado a `rol === 'ENTRENADOR' && estado === 'ACTIVO'` (T4). Al editar
  una clase con entrenador inactivo, el selector lo muestra como opción actual marcada "inactivo".
- `PaginaPanel`: dos opciones nuevas con el mismo permiso; la clave de React pasa a ser la ruta.

### 8. Semilla

En `delfines`, con `enAcademia`: un segundo entrenador inventado (DNI `10000005`, como los de 002, con
`ON CONFLICT (academia_id, dni) DO NOTHING`); los dos planes (`ON CONFLICT DO NOTHING` sobre el índice del nombre); y
clases de ejemplo de los tres niveles, dos en el mismo bloque con entrenadores distintos (`ON CONFLICT DO NOTHING` sobre
los índices parciales). Repetirla no duplica ni pisa cambios (criterio 30).

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Arreglos en la fila del plan (D1) | Tablas hijas | Menos uniones y escrituras; `CHECK` directos |
| `time(0)` y `"HH:MM"` (D2) | Entero de 8 a 19 | Comparar con el reloj en 009 sin conversiones |
| Montos como texto en el JSON (D3) | Números JSON | El lector de JSON pasa por coma flotante |
| Índices únicos parciales y `ON CONFLICT` (D4) | Consultar antes de insertar | Dos creaciones simultáneas pasarían |
| Bloqueo de la fila de la clase para el cupo (D5) | Bloqueo consultivo por clase; contador en la fila | Visible en la fila, un solo lugar, no se desincroniza |
| Llave compuesta al entrenador (D6) | Llave simple a `usuarios(id)` | Criterio 12 de 001; las llaves no pasan por RLS |
| Nivel, día y hora sin privilegio de `UPDATE` (D7) | Validarlo solo en la API | La base lo garantiza aunque la API fallara |
| Sin `DELETE` (D8) | Borrado lógico con columna aparte | `activo` ya es el borrado lógico |
| Auditar todo cambio (D9) | Solo precio y aforo | Mismo costo, auditoría completa |
| Estado del plan calculado al leer (D10) | Columna por tarea programada | Nunca queda viejo |
| Entrenador leído sin bloqueo (D11) | Bloquear su fila | Orden de bloqueos para las historias siguientes |
| `bloquearClasesParaCupo` sin Nest | Método de `ClasesService` | Las historias 005 a 020 la usan sin depender del módulo (como `leerConfiguracion`) |
| Reutilizar `GET /api/usuarios` para elegir entrenador (DT-4) | Ruta nueva | El administrador ya tiene el permiso |
| Reutilizar `CONFIGURAR_PLANES_HORARIOS_AFORO` (DT-2) | Permiso nuevo de lectura | La matriz dice lo que permite; DR-7 |
| Ocupación, reservas y prueba del último cupo en la 005 (DT-1) | Tabla de matrículas en la 004 | Adelantaría el diseño de la 005 (D-17); la 004 deja el bloqueo común |

## Migraciones

- `<marca>_planes_clases`: tipo `nivel_natacion`, tablas `planes` y `clases`, `CHECK`, índices, RLS forzada, políticas
  y privilegios (spec, "Cambios al modelo de datos"). Sin datos.

## Riesgos

- **Interbloqueos con las llaves foráneas:** el `INSERT` o el cambio de entrenador de una clase toma `FOR KEY SHARE`
  sobre la fila del entrenador; desactivarlo en 002 toma `FOR UPDATE` sobre esa fila. No hay ciclo con el orden actual
  (sección 6), pero el adversarial debe probar a la vez: crear una clase con el entrenador E, desactivar a E y
  desactivar al administrador que crea.
- **`23505` dentro de la transacción:** un error de la base la deja abortada (criterio 149 de 001); el 409 se decide
  después del `ROLLBACK`, por el nombre de la restricción. Hay que comprobar que nunca se responde 500 en las carreras
  de los criterios 11 y 20 f.
- **Coma flotante en el precio:** cualquier `Number(precio)` en el backend o la web rompe el criterio 10. El revisor
  busca `Number(`, `parseFloat` y `+precio` en los módulos de planes y en `lib/dinero.ts`.
- **Horas con segundos o zona:** `hora_inicio::text` puede dar `08:00:00`; se usa `to_char(…, 'HH24:MI')`.
- **Revisar más adelante los límites aprobados (DR-1, DR-3, DR-4):** los de la API cambian en los contratos; los de la
  base (DR-3, DR-4) necesitan otra migración.
- **Pruebas protegidas de 001 y 002 con listas exactas** (privilegios y tablas): si alguna no está prevista en las
  tareas, el tester lo reporta en el rojo y decide el orquestador.
