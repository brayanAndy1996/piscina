# 004 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes") y las specs [`001`](../001-academias-aislamiento/spec.md),
[`002`](../002-autenticacion-roles/spec.md) y [`003`](../003-configuracion-academia/spec.md). Lo que no es orientativo
es el contrato de `spec.md`.

**Estado:** aprobado con la spec (17/11/2026). Bryan aceptó las propuestas de N1 a N8 (DR-1 a DR-8 de 004) y el
orquestador las de T1 a T5 (DT-1 a DT-5 de 004); el diseño no cambia. Los límites de N1, la clase única por nivel y
bloque de N3 y los campos inmutables de N4 quedan como están en este plan. Si algún día se revisan, cambian los
esquemas, un índice único y los privilegios de `clases` (con otra migración); el resto del diseño no.

**Ajustes de la implementación (backend, commit be7170a):** AT-1 a AT-5 de la spec ("Decisiones"), ya reflejados en
las secciones de abajo. El más importante es AT-1: al crear o reasignar una clase, el entrenador se bloquea junto con el
actor (modifica D11; secciones 6 y "Riesgos").

**Ronda 1 adversarial (17/11/2026):** 3 fallas (32, 33, 34). Cómo se corrige cada una, en la sección 9 de abajo.

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
│   ├── package.json                     + date-fns ^4.4.0 y @date-fns/tz ^1.5.0 (D-25; AT-3)
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
│       └── integracion/planes-clases/   pruebas protegidas y no protegidas (una carpeta para las dos)
├── scripts/
│   ├── lib/rol-app.mjs                  + privilegios de planes y clases (misma lista que PRIVILEGIOS_APP)
│   ├── lib/dependencias-backend.mjs     + date-fns y @date-fns/tz (criterio 127 de 001; AT-3)
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
  Límites exportados (`LIMITES_PLAN`) para la web. Campo de los errores de los arreglos (AT-4): el de un elemento lleva
  el índice (`diasPermitidos.2`, `franjasPermitidas.0`, `nivelesAplicables.0`); los de la lista entera (vacía,
  repetidos, menos días que `vecesPorSemana`) van al nombre de la lista.
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
`array_position(col, NULL) IS NULL` en los tres arreglos. _(No se hizo en be7170a; lo corrige la migración de la
ronda 1, sección 9.2, junto con las dimensiones, `NaN` y las fechas infinitas.)_

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
   En el `PATCH`, recién después se valida el `{id}` (UUID, en minúsculas; si no, 404): el controlador no usa
   `IdDeRuta` (AT-2), para que el 404 de un id que no es UUID sea idéntico al de uno inexistente o de otra academia y
   llegue después del 400 del cuerpo y del 401.
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

1. `bloquearActorVigente(tx, actor, { objetivoId: entrenadorId, … })` (AT-1, modifica D11): una sola sentencia
   bloquea las filas de `usuarios` del actor y del entrenador, `ORDER BY id FOR UPDATE` (el mismo orden que la
   desactivación de 002), antes de cualquier fila de `clases`. Un entrenador de otra academia o inexistente no devuelve
   fila.
2. Entrenador: sobre la fila bloqueada del paso 1; si no existe o no es un `ENTRENADOR` `ACTIVO`, 409
   `ENTRENADOR_NO_VALIDO`.
3. `INSERT INTO clases … ON CONFLICT DO NOTHING RETURNING …`. Sin fila: una consulta mira qué choca (primero una clase
   activa del mismo nivel en el bloque → `CLASE_DUPLICADA`; si no, una del mismo entrenador → `ENTRENADOR_OCUPADO`).
   `ON CONFLICT DO NOTHING` sin destino espera a la transacción que tiene la fila en conflicto, así que la consulta
   posterior ve la fila confirmada (criterio 20 f).
4. Auditoría `CLASE_CREADA`.

**`PATCH /api/clases/{id}`:**

1. `bloquearActorVigente`: con `entrenadorId` en el cuerpo, con `objetivoId` (actor y entrenador en una sentencia,
   `FOR UPDATE`, como el paso 1 del `POST`; AT-1); sin él, solo el actor (`FOR SHARE`). Después, el `{id}` se valida en
   el servicio (no UUID → 404; AT-2).
2. `bloquearClasesParaCupo(tx, [id])`, siempre (criterio 22); sin fila → 404.
3. Si viene `entrenadorId` distinto: comprobar la fila bloqueada del entrenador del paso 1. Si es `activo: true` sobre
   una clase inactiva con el mismo entrenador: `SELECT rol, estado` sin bloqueo (D11, el único caso que queda; la clase
   no cambia `entrenador_id` y no toma `FOR KEY SHARE`).
4. `cambiosPedidosClase`; sin cambios → devolver sin escribir.
5. `UPDATE clases SET … WHERE academia_id = … AND id = …`. Un cambio de entrenador o una reactivación puede chocar con
   los índices parciales (`23505`): la transacción aborta y se responde 409 con el código del índice que chocó
   (identificado por el nombre de la restricción del error, sin su mensaje). Alternativa equivalente: comprobar antes
   con una consulta y dejar el índice como red de seguridad; con la fila de la clase bloqueada, la única carrera
   posible es con otra clase que entra al mismo bloque, que el índice resuelve.
6. Auditoría `CLASE_ACTUALIZADA`.

**Orden de bloqueos:** `usuarios` (actor, y el entrenador si se asigna, en una sentencia ordenada por id) → `clases`
(`FOR UPDATE`, ordenadas por id). _(Corregido por AT-1.)_ El plan original decía que no había ciclo porque desactivar un
usuario (002) nunca toca `clases`; no era así. La llave foránea toma `FOR KEY SHARE` sobre la fila del entrenador al
insertar o cambiar `entrenador_id`, y la desactivación toma `FOR UPDATE` sobre el actor y el objetivo ordenados por id.
Con el actor bloqueado primero (`FOR SHARE`) y el entrenador después (por la llave), el mismo administrador que crea
una clase con E y desactiva a E a la vez producía `40P01` y un 500. Al bloquear las dos filas juntas y en el orden de
la desactivación, las dos transacciones se ordenan. Prueba no protegida:
`backend/test/integracion/planes-clases/clases-interbloqueo.test.ts`.

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
los índices parciales). Repetirla no duplica ni pisa cambios (criterio 30). El segundo entrenador cambia lo que
comprueba la prueba protegida del criterio 45 de 002 (5 usuarios en `delfines`, 6 en total, dos entrenadores): se
agrega después del commit "Pruebas protegidas (004)" que la actualiza (AT-5).

### 9. Correcciones de la ronda 1 adversarial

Orden: pruebas protegidas en rojo de 32 y 33 (test-writer), después estas correcciones (backend). El 34 lleva prueba no
protegida, escrita por quien implementa.

#### 9.1. Choques de clases sin 500 (criterio 32)

Causa: el `POST` hace `INSERT … ON CONFLICT DO NOTHING` y, sin fila, busca el choque con otra sentencia; el `PATCH`
relee las clases después del `23505`. Si la clase que chocó se desactiva (o se reactiva otra) en una transacción
confirmada entre las dos sentencias, la búsqueda no encuentra nada y el servicio termina en 500.

Corrección:

- **`POST`:** `INSERT … RETURNING …` sin `ON CONFLICT`. Igual que con `ON CONFLICT`, si la fila en conflicto es de una
  transacción sin confirmar, el `INSERT` la espera; si esa transacción la desactiva o se deshace, el `INSERT` pasa (201).
  Si choca, salta `23505`, la transacción aborta (criterio 149 de 001) y el 409 se decide después del `ROLLBACK` por el
  nombre de la restricción: `clases_nivel_bloque_activo_key` → `CLASE_DUPLICADA`; `clases_entrenador_bloque_activo_key`
  → `ENTRENADOR_OCUPADO`. El nombre sale del error estructurado del adaptador (`constraint`/`index`, como en
  `punto-autorizado.test.ts`), nunca del texto del mensaje. Cualquier otro `23505` o un error sin nombre sigue su
  camino normal (no se adivina un 409).
- **`PATCH`:** el mismo mapeo al `23505` del `UPDATE`, sin releer.
- **Criterio 20 e (los dos choques a la vez):** PostgreSQL informa una sola restricción, la del primer índice que
  comprueba, y ese orden no es parte del contrato. Para mantener el 20 e: si la restricción es la del entrenador, una
  consulta posterior (otra transacción, sin bloqueo) puede mirar si además hay una clase activa del mismo nivel en el
  bloque y, si la hay, responder `CLASE_DUPLICADA`; si no la encuentra (la carrera del 32), responde
  `ENTRENADOR_OCUPADO`. Esa consulta solo elige entre los dos 409; nunca puede terminar en 500. En el `PATCH`, solo la
  reactivación puede chocar con los dos índices (cambiar el entrenador de una clase activa no cambia su nivel ni su
  bloque).
- **Alternativa aceptada por la spec:** reintentar la escritura (una vez o un número pequeño de veces) cuando la
  búsqueda no encuentra el choque; si se elige, el último intento debe responder igual un 409 por nombre de restricción
  o el éxito, nunca 500. Se prefiere el mapeo por nombre porque es determinista y no depende de cuántas veces cambie la
  otra clase.
- **Alternativa descartada:** seguir con `ON CONFLICT DO NOTHING` y releer (es la causa), o un `SAVEPOINT` por
  escritura (no hace falta: antes del `INSERT` no se escribió nada que haya que conservar).
- Se mantienen el orden de bloqueos de AT-1, la idempotencia y el 20 f (una fila y una `CLASE_CREADA`). El 409 sale
  después del `ROLLBACK`, así que no hay auditoría.
- Pruebas protegidas deterministas (test-writer): la prueba deja una transacción sin confirmar que desactiva la clase C
  que va a chocar (o que reactiva otra), lanza el `POST` o el `PATCH`, comprueba en `pg_locks` que espera, y confirma;
  y la variante en que la desactivación se confirma justo después del choque. En todas: 201/200 o 409 con uno de los
  dos códigos, nunca 500, y filas y auditoría coherentes con la respuesta.

#### 9.2. Migración con más `CHECK` (criterio 33)

Migración nueva `<marca>_planes_clases_invariantes` (la de `planes_clases` ya está aplicada en las bases de desarrollo
y no se edita). Con `ALTER TABLE planes DROP CONSTRAINT …, ADD CONSTRAINT …` en una sola sentencia:

- `planes_precio_positivo`: `precio > 0 AND precio <> 'NaN'::numeric` (en PostgreSQL `NaN` es igual a sí mismo y mayor
  que cualquier número; `numeric(10,2)` ya rechaza `Infinity`).
- `planes_dias_permitidos_validos`, `planes_franjas_permitidas_validas` y `planes_niveles_aplicables_no_vacios`: exigir
  una sola dimensión y ningún `NULL`. `<@` y `cardinality` aplanan las dimensiones, por eso hoy un `'{{1,2},{3,4}}'`
  pasa. Dos cuidados: un `CHECK` que da `NULL` cuenta como cumplido (`array_ndims` de un arreglo vacío es `NULL`), y
  `array_position` lanza un error (`0A000`, no `23514`) con un arreglo de varias dimensiones, y PostgreSQL no garantiza
  el orden de evaluación de un `AND`. Forma sugerida, con `CASE` para fijar el orden:
  `CASE WHEN array_ndims(col) = 1 THEN array_position(col, NULL) IS NULL AND <condición actual> ELSE false END`.
  Las pruebas comprueban `23514` (no `0A000`) para cada caso del criterio 33 b.
- Nuevo `planes_vigencia_finita`: `(vigencia_inicio IS NULL OR isfinite(vigencia_inicio)) AND (vigencia_fin IS NULL
  OR isfinite(vigencia_fin))`.
- Los nombres de restricción se conservan o se nombran con el prefijo `planes_` (las pruebas buscan `23514`, no el
  nombre).
- `ADD CONSTRAINT` valida las filas existentes: si una base de desarrollo tiene filas inválidas escritas a mano, la
  migración falla y hay que limpiarla; no hay datos reales (repositorio público, D-26).
- Sin cambios de columnas, índices, políticas ni privilegios: `PRIVILEGIOS_APP`, `rol-app.mjs` y
  `TABLAS_DESPUES_DE_MIGRAR` no cambian. Las pruebas de catálogo de 001 deben seguir pasando.
- `GET /api/planes` no cambia: con la base garantizando la forma, no hay que defender la lectura de filas imposibles.

#### 9.3. Nombre del plan normalizado (criterio 34, DT-6)

- `packages/contratos/src/planes.ts` (o `texto.ts` si se quiere reutilizar): función pura exportada
  `normalizarNombrePlan(texto)`: `normalize('NFC')`; reemplazar `\p{Zs}` por `' '`; eliminar `\p{Cf}` salvo
  `\p{Bidi_Control}` (que `textoVisibleSchema` sigue rechazando con 400); colapsar `' '+` en uno; recortar.
- `nombrePlanSchema = z.string().transform(normalizarNombrePlan).pipe(textoVisibleSchema(…))` (o el equivalente en
  zod 4), para que los límites de 3 a 80 caracteres y 3 visibles se midan sobre el nombre normalizado y la API guarde lo
  que validó. `textoVisibleSchema` no cambia para los demás campos.
- Servicio de planes: no cambia el `INSERT` ni el índice (`lower(nombre)`); recibe ya el nombre normalizado.
  `cambiosPedidosPlan` compara el nombre normalizado con el guardado (un renombre que solo cambia espacios invisibles
  es "sin cambios").
- Web: el formulario usa el mismo esquema, así que el nombre que muestra después de guardar es el normalizado.
- Prueba no protegida (backend): unitarias de `normalizarNombrePlan` (NFD → NFC, U+00A0, U+3000, U+200B, U+FEFF,
  U+00AD, espacios dobles, bidi sigue fallando) e integración de los cuatro 409 del criterio 34 en `POST` y `PATCH`.

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
| Entrenador bloqueado junto con el actor al crear o reasignar (AT-1, modifica D11) | Leerlo sin bloqueo (D11 original); bloquearlo después de la clase | Sin bloqueo, la llave foránea lo toma después del actor y choca con la desactivación de 002 (`40P01`); después de la clase rompería el orden de bloqueos. Sin bloqueo solo al reactivar con el mismo entrenador |
| `{id}` de los `PATCH` validado en el servicio (AT-2) | `IdDeRuta` | El 404 de un id que no es UUID igual al de uno inexistente, después del 400 del cuerpo y del 401 |
| `bloquearClasesParaCupo` sin Nest | Método de `ClasesService` | Las historias 005 a 020 la usan sin depender del módulo (como `leerConfiguracion`) |
| Reutilizar `GET /api/usuarios` para elegir entrenador (DT-4) | Ruta nueva | El administrador ya tiene el permiso |
| Reutilizar `CONFIGURAR_PLANES_HORARIOS_AFORO` (DT-2) | Permiso nuevo de lectura | La matriz dice lo que permite; DR-7 |
| Ocupación, reservas y prueba del último cupo en la 005 (DT-1) | Tabla de matrículas en la 004 | Adelantaría el diseño de la 005 (D-17); la 004 deja el bloqueo común |
| 409 de los choques por el nombre de la restricción (ronda 1, criterio 32) | `ON CONFLICT DO NOTHING` y releer; reintentar | Releer falla si la clase que chocó cambió entre medio (500); el nombre es determinista. Reintentar queda permitido por la spec |
| Migración nueva para los `CHECK` de la ronda 1 (criterio 33) | Editar la migración ya aplicada | Las bases de desarrollo ya la aplicaron; Prisma detecta el cambio en la suma de comprobación de una migración aplicada |
| Nombre del plan normalizado en el esquema zod (DT-6, criterio 34) | Solo en el servicio; índice sobre `normalize(...)` en la base | La web ve y cuenta lo mismo que guarda la API; el índice no resuelve espacios ni formato |

## Migraciones

- `<marca>_planes_clases`: tipo `nivel_natacion`, tablas `planes` y `clases`, `CHECK`, índices, RLS forzada, políticas
  y privilegios (spec, "Cambios al modelo de datos"). Sin datos.
- `<marca>_planes_clases_invariantes` (ronda 1, criterio 33): solo `CHECK` de `planes` (sección 9.2). Sin datos ni
  cambios de privilegios.

## Riesgos

- **Interbloqueos con las llaves foráneas:** el `INSERT` o el cambio de entrenador de una clase toma `FOR KEY SHARE`
  sobre la fila del entrenador; desactivarlo en 002 toma `FOR UPDATE` sobre esa fila y la del actor. _(Ocurrió, AT-1.)_
  Con la lectura sin bloqueo de D11 sí había ciclo (el mismo administrador creando una clase con E y desactivando a E:
  `40P01` y 500); se resolvió bloqueando al entrenador con el actor (sección 6). El adversarial debe seguir probando a
  la vez: crear o reasignar una clase con E, desactivar a E, desactivar al administrador que crea y reactivar una clase
  con el mismo entrenador (el único caso que lo lee sin bloqueo).
- **Actor con `FOR UPDATE` en las escrituras de clases con entrenador (AT-1):** dos de esas escrituras del mismo
  administrador se ordenan en vez de ir en paralelo. Es aceptable por el volumen (configuración del administrador).
- **Segundo entrenador de la semilla (AT-5):** rompe la prueba protegida del criterio 45 de 002 hasta que el
  test-writer la actualice en un commit "Pruebas protegidas (004)"; la parte de T10 que lo agrega espera ese commit.
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
- **Ronda 1, criterio 32:** el nombre de la restricción tiene que llegar en el error estructurado del adaptador de
  Prisma; si en algún camino solo viene el mensaje, no se lee el mensaje: se usa la alternativa de reintentar. El
  revisor busca `message` o `includes(` sobre errores de la base en el módulo de clases.
- **Ronda 1, criterio 33:** un `CHECK` que da `NULL` pasa, y `array_position` falla con `0A000` en arreglos de varias
  dimensiones; las pruebas deben exigir `23514` exacto.
- **Ronda 1, criterio 34:** un cambio en `nombrePlanSchema` no debe tocar `textoVisibleSchema` ni los demás campos que
  lo usan (001, 002, 003).
