# 003 · Plan técnico

Referencias: [`spec.md`](spec.md), [`docs/arquitectura.md`](../../docs/arquitectura.md) (sobre todo "Reglas para las
historias siguientes") y las specs [`001`](../001-academias-aislamiento/spec.md) y
[`002`](../002-autenticacion-roles/spec.md). Lo que no es orientativo es el contrato de `spec.md`.

**Estado:** borrador (17/11/2026). Si el responsable cambia los rangos (N1) o la prioridad (N3), solo cambia la tabla
de claves de los contratos.

## Módulos afectados

```
piscina/
├── packages/contratos/src/
│   ├── configuracion.ts (+ .test.ts)          nuevo: tabla de claves, esquemas y respuestas
│   ├── permisos.ts                            + CONFIGURAR_ACADEMIA
│   └── index.ts                               + exportaciones
├── backend/
│   ├── prisma/seed.ts                         + teléfono de ejemplo de delfines (criterio 25)
│   ├── src/app.module.ts                      + ConfiguracionModule
│   ├── src/modulos/configuracion/             nuevo
│   │   ├── dominio/valores.ts (+ .test.ts)    valor efectivo de cada clave y cambios (funciones puras)
│   │   ├── lectura.ts                         leerConfiguracion(tx), sin Nest (D6)
│   │   ├── configuracion.service.ts           obtener, actualizar (transacción, bloqueo, auditoría), miAcademia
│   │   ├── configuracion.controller.ts        GET/PATCH /configuracion, GET /mi-academia
│   │   ├── configuracion.module.ts · index.ts
│   ├── src/modulos/autenticacion/
│   │   ├── sesion-academia.service.ts         conteo con los valores de la academia; mensaje del 423
│   │   └── dominio/reglas-bloqueo.ts          reglasBloqueoDe(configuracion) en lugar de la constante
│   └── test/
│       ├── utilidades/configuracion.ts        fijarConfiguracionEnBase (test-writer, protegida)
│       └── integracion/configuracion/         pruebas protegidas y no protegidas
├── frontend/src/
│   ├── api/configuracion.ts                   consultas (TanStack Query)
│   ├── modulos/configuracion/PaginaConfiguracion.tsx (+ .test.tsx)
│   ├── modulos/panel/LayoutPanel.tsx · PaginaPanel.tsx   menú y teléfono
│   ├── modulos/sesion/mensajes.ts             423 sin "15 minutos" fijo (criterio 19)
│   └── rutas/Rutas.tsx                        + /panel/configuracion
└── docs/arquitectura.md · README.md           documentador (criterio 26)
```

## Diseño

### 1. Contratos

`configuracion.ts` define una sola tabla de claves (`CLAVES_CONFIGURACION`: campo de la API, clave en la base, valor
por defecto, mínimo y máximo) y de ella salen `CONFIGURACION_POR_DEFECTO`, `LIMITES_CONFIGURACION` y los esquemas. Los
enteros usan `z.number().int().min().max()` (un texto con dígitos no se convierte). `telefonoAcademiaSchema` usa
`sinControles` de `texto.ts`, recorta y aplica el patrón del criterio 10 (`^\+?[0-9 ()-]+$`, de 6 a 20 caracteres y al
menos 6 dígitos ASCII). `actualizarConfiguracionSchema` es un `z.strictObject` con todo opcional y un `refine` de "al
menos un campo".

### 2. Dominio (funciones puras)

- `valorEfectivo(campo, valorGuardado | ausente)` → `{ valor, invalido: boolean }`: si no hay fila, el valor por
  defecto; si la hay, la valida con el esquema de su campo (sin recortar ni convertir: lo guardado ya debe estar
  normalizado); si no cumple, el valor por defecto e `invalido`.
- `configuracionEfectiva(filas)` → `{ configuracion, clavesInvalidas }`: ignora las claves desconocidas.
- `cambiosPedidos(filas, pedido)` → la lista de campos a escribir (criterio 9: se escribe si no hay fila y el valor no
  es el de por defecto, o si la fila guardada no es exactamente el valor nuevo) con su valor efectivo de antes y el
  nuevo, para la auditoría.

### 3. Lectura (`lectura.ts`)

`leerConfiguracion(tx, opciones)` ejecuta una sola sentencia,
`SELECT clave, valor FROM configuraciones WHERE academia_id = ${tx.academiaId}::uuid AND clave IN (…claves del
contrato…)`, calcula `configuracionEfectiva` y, por cada clave inválida, llama a `opciones.registro.warn({ academiaId,
clave }, 'Valor de configuración inválido: se usa el valor por defecto')` sin el valor. No guarda nada fuera de la
llamada.

### 4. `PATCH /api/configuracion`

El controlador valida con `ValidarCon(actualizarConfiguracionSchema)` y llama al servicio con la sesión
(`@SesionActual()`, `actorDeSesion`) y la IP. El servicio, en un solo `conAcademia(sesion.usuario.academiaId, …)`:

1. `bloquearActorVigente(tx, { id, versionToken }, { registro, ip })` (`FOR SHARE`, sin objetivo) como primera
   sentencia (criterio 11).
2. `SELECT pg_catalog.pg_advisory_xact_lock(hashtextextended('configuracion:' || ${academiaId}, 0))` con `$executeRaw`
   (D4; los cambios de la misma academia se ordenan, criterio 12).
3. Lee las filas con la misma consulta de `leerConfiguracion`, calcula `cambiosPedidos`. Si no hay cambios, devuelve la
   configuración efectiva sin escribir (criterio 9).
4. Una sola sentencia para todas las filas: `INSERT INTO configuraciones (academia_id, clave, valor, actualizado_en)
   VALUES … ON CONFLICT (academia_id, clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en =
   EXCLUDED.actualizado_en`, con `actualizado_en` de `RELOJ` y cada valor como `jsonb` (para `null`, `'null'::jsonb`).
5. `AuditoriaService.registrarEnAcademia` con `CONFIGURACION_ACTUALIZADA` (criterio 7).
6. Devuelve la configuración efectiva calculada con lo escrito.

No hay efectos secundarios fuera de la transacción.

Orden de bloqueos: fila del actor (`FOR SHARE`) → bloqueo de la academia. Ninguna otra transacción toma el bloqueo de
la academia y luego espera una fila de `usuarios`, así que no hay ciclo; el conteo de fallos (sección 6) solo lee
`configuraciones` sin bloquearla.

### 5. Lecturas

- `GET /api/configuracion`: `conAcademia` + `leerConfiguracion` (criterios 1 a 3).
- `GET /api/mi-academia`: en un `conAcademia`, `leerConfiguracion` para el teléfono y el `nombre` y `nombre_corto` de la
  academia de la transacción (la RLS de `academias` deja ver la propia). `@SoloSesion` (criterio 20).

### 6. Bloqueo en `SesionAcademiaService`

- `contarFalloEnTransaccion(tx, id)` (lo usan el ingreso y el cambio de clave) llama a `leerConfiguracion(tx)` justo
  después del `SELECT … FOR UPDATE` del usuario y antes del `UPDATE`, siempre, exista o no la fila: la secuencia es la
  misma en los cuatro casos del criterio 53 de 002 (criterio 17, D5). Pasa `reglasBloqueoDe(configuracion)` a
  `evaluarIntentoFallido`.
- `estaBloqueado` no cambia: depende solo de `bloqueado_hasta`, así que un cambio de los valores no alarga ni acorta un
  bloqueo ya puesto (criterio 15 b).
- `REGLAS_BLOQUEO_USUARIO` se reemplaza por `reglasBloqueoDe(configuracion)`; `REGLAS_BLOQUEO_SUPERADMIN` no se toca
  (criterio 18).
- `cuentaBloqueada(bloqueadoHasta, ahora)`: el mensaje con los minutos que faltan, redondeados hacia arriba y como
  mínimo 1 (criterio 19). `ResultadoFallo` de tipo `BLOQUEADA` lleva el `bloqueadoHasta` que se acaba de escribir o el
  que ya tenía la fila, y los demás caminos que responden 423 ya leyeron la fila.

### 7. Web

- `api/configuracion.ts`: `useConfiguracion`, `useActualizarConfiguracion` (invalida la consulta al guardar) y
  `useMiAcademia`.
- `PaginaConfiguracion`: React Hook Form con `actualizarConfiguracionSchema`; compara con lo cargado y envía solo lo que
  cambió; los textos de ayuda, unidades, rangos y valores por defecto salen de `CLAVES_CONFIGURACION`. Los errores 400
  se ponen en el campo de `detalles.errores[].campo`. Antes de enviar, la comprobación previa de la sesión de 002
  (criterio 59 de 002).
- `LayoutPanel`: muestra el nombre y el teléfono de `useMiAcademia`; si falla, no muestra nada más.
- Menú y ruta con `puede(rol, 'CONFIGURAR_ACADEMIA')` y `RequierePermiso`.
- `modulos/sesion/mensajes.ts`: el 423 de la academia muestra el `mensaje` de la respuesta (con los minutos que faltan)
  más "Si no puedes esperar, pide en recepción que la restablezcan"; sin el número fijo (criterio 19). El de la
  plataforma (`modulos/plataforma/mensajes.ts`) no cambia.

### 8. Semilla

`seed.ts` escribe en `delfines`, con `enAcademia`, la fila `telefono` con un número inventado, con `ON CONFLICT DO
UPDATE` para poder repetirse (criterio 25). `tiburones` queda sin filas.

## Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Valores por defecto en el código; sin fila = por defecto (D1) | Filas al crear la academia o por migración | La plataforma no escribe en `configuraciones` (RLS, D-29); no cambia los conteos de 001; vale para academias futuras |
| `valor` con el JSON escalar (D2) | Objeto `{ valor }` | Más simple, misma validación |
| Validación al escribir y al leer; sin `CHECK` (D3) | `CHECK` por clave | Cada clave nueva pediría migración; el dueño puede quitarlo |
| `PATCH` parcial + `pg_advisory_xact_lock` por academia (D4) | `PUT` completo; versión optimista | No pisa campos ajenos; auditoría encadenada; menos trabajo en la web |
| Leer la configuración dentro del conteo de fallos (D5) | Leerla antes, solo si hay cuenta | Criterio 53 de 002 |
| `leerConfiguracion` sin Nest (D6) | Servicio inyectado en `SesionAcademiaService` | Evita la dependencia circular entre módulos |
| `GET /api/mi-academia` (D7) | Agregar el teléfono a `GET /api/a/{nombreCorto}` o a la sesión | Pruebas protegidas y esquemas estrictos de 001 y 002 |
| Permiso `CONFIGURAR_ACADEMIA` (T1) | Reutilizar `CONFIGURAR_PLANES_HORARIOS_AFORO` | Es otra función; la matriz debe decir lo que permite |

## Migraciones

Ninguna (spec, "Cambios al modelo de datos").

## Riesgos

- **Romper el criterio 53 de 002:** si la lectura de la configuración queda en un camino que no recorren los cuatro
  casos (por ejemplo, solo cuando hay cuenta), el tiempo vuelve a delatar el DNI. Lo cubren el criterio 17 y la prueba
  protegida de 002, que no cambia.
- **Interbloqueos:** el `PATCH` toma la fila del actor y luego el bloqueo de la academia; si alguna escritura futura
  tomara el bloqueo de la academia y después filas de `usuarios`, podría formarse un ciclo. Se documenta el orden en
  `docs/arquitectura.md` (criterio 26).
- **Un valor por defecto que cambie en el código** no cambia las academias que ya lo guardaron explícitamente (se guarda
  la fila solo si el valor no es el de por defecto, criterio 9, así que la mayoría seguirá el nuevo).
- **Pruebas protegidas de 002 que dependen del texto del 423:** no deberían existir (002 compara códigos); si alguna lo
  hiciera, el tester lo reporta en el rojo y decide el orquestador.
