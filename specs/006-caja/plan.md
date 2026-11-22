# 006 · Plan técnico

Plan de la [spec](spec.md), aprobada el 22/11/2026 con las decisiones DR-1 a DR-11 (responsable) y DT-1 a DT-6
(orquestador) de la spec; los valores que el borrador llamaba "provisionales" quedan como definitivos. Lo marcado
**[006b]** va en el segundo PR (DR-10).

## 1. Módulos afectados

**006a**

- `packages/contratos/src/dinero.ts`: `montoNoNegativoSchema`, `montoConSignoSchema` (tope `9999999999.99` en valor
  absoluto, sin `"-0.00"`) y `restarMontos` (céntimos con `bigint`; siempre dos decimales, nunca `"-0.00"`), con pruebas
  unitarias (PP3 de la spec). Los montos sin signo de las respuestas se leen con el mismo formato, no con
  `montoNoNegativoSchema`.
- `packages/contratos/src/caja.ts` _(nuevo)_ y su reexportación en `index.ts`: esquemas del contrato de la spec.
- `packages/contratos/src/permisos.ts`: `REABRIR_CAJA: { ADMIN: 'TODO' }` (DT-1).
- `backend/prisma/schema.prisma` y la migración `<marca>_caja`.
- `backend/src/infraestructura/prisma/privilegios-app.ts` (`PRIVILEGIOS_APP`), `scripts/lib/rol-app.mjs` y
  `TABLAS_DESPUES_DE_MIGRAR` de `scripts/test/integracion/migraciones.test.mjs`.
- `backend/src/modulos/caja/` _(nuevo)_:
  - `caja.module.ts`, `cajas.controller.ts` y `cajas.service.ts` (apertura, caja actual, egreso, cierre y reapertura);
  - `movimientos.ts` (sin Nest): `registrarIngresoEnCaja`, `registrarEgresoEnCaja`, `leerCajaAbierta` y las funciones
    internas `bloquearCajaAbierta`, `bloquearCaja`, `siguienteNumero`, `leerResumen`;
  - `lectura.ts` (sin Nest): arma `Caja` (resumen, movimientos y cierres) con una consulta por parte;
  - `dominio/esperado.ts` (`calcularResumen`, `calcularDiferencia`, `resultadoDe`) y `dominio/dia.ts`
    (`esDeOtroDia(fechaCaja, ahora)`, `esCierreTardio(fechaCaja, cerradoEn)`), puras, con sus pruebas unitarias;
  - `errores.ts` (los `ErrorNegocio` de los códigos nuevos);
  - `index.ts` (exporta `movimientos.ts` y los tipos).
- `backend/src/app.module.ts`: importa `CajaModule`.
- `backend/prisma/seed.ts`: la caja de ejemplo de `delfines` (criterio 45).
- `frontend/src/modulos/caja/` _(nuevo)_: `PaginaCaja.tsx`, `FormularioApertura.tsx`, `DialogoEgreso.tsx`,
  `DialogoCierre.tsx`, `DialogoReapertura.tsx`, `ResumenCaja.tsx`, `ListaMovimientos.tsx`, `hooks.ts`; su prueba de
  componentes. Ruta `/panel/caja` en `frontend/src/rutas/Rutas.tsx` y opción "Caja" en `PaginaPanel.tsx`.
- `e2e/pruebas/caja.spec.ts`: flujo de la caja del día (criterio 38).

**[006b]**

- `packages/contratos/src/caja.ts`: `filtroHistorialCajasSchema`, `cajaHistorialSchema`, `respuestaHistorialCajasSchema`.
- `backend/src/modulos/caja/historial.service.ts` (lista y detalle con el alcance `SU_CAJA`), `pdf/cierre-pdf.ts`
  (`generarPdfCierre(datos): Promise<Buffer>`, pura respecto de la base) y las rutas `GET` del historial en el
  controlador.
- `backend/package.json`: `pdfkit` y `@types/pdfkit`; `scripts/lib/dependencias-backend.mjs`
  (`DEPENDENCIAS_BACKEND_PERMITIDAS`, criterio 127 de 001).
- `frontend/src/modulos/caja/`: `PaginaHistorialCajas.tsx`, `DetalleCaja.tsx`; ruta `/panel/cajas` y opción "Historial de
  caja".

## 2. Diseño

### 2.1 Bloqueos y transacciones

Todas las escrituras corren en `BaseDatos.conAcademia(<academia de la sesión>, …)` con aislamiento `ReadCommitted` (el
de siempre). Orden fijo de bloqueos, que comparte la 007:

1. `bloquearActorVigente(tx, actor, { registro, ip })` (`FOR SHARE`), primera sentencia.
2. Solo apertura y reapertura: `pg_advisory_xact_lock(hashtextextended('caja:' || academiaId, 0))`. Ordena las dos
   operaciones que pueden dejar una caja abierta y hace que la apertura decida sus 409 en orden fijo (criterios 13 a 15 y
   36 b). Los índices únicos siguen siendo la garantía de la base.
3. La fila de la caja con `FOR UPDATE`:
   - egreso y cierre: `SELECT … FROM cajas WHERE academia_id = $a AND id = $id FOR UPDATE`;
   - ingreso de la 007: `SELECT … FROM cajas WHERE academia_id = $a AND estado = 'ABIERTA' FOR UPDATE`. En
     `ReadCommitted`, si un cierre confirma mientras se espera, PostgreSQL vuelve a evaluar la condición sobre la fila
     nueva y no la devuelve: `SIN_CAJA_ABIERTA` (criterio 33 c);
   - reapertura: la caja pedida, después del bloqueo consultivo.
4. Escrituras (movimiento, cierre, `UPDATE` de estado) y auditoría con `insertarEnAuditoriaDeAcademia` (o
   `AuditoriaService.registrarEnAcademia`), en la misma transacción.

Ninguna transacción de esta historia bloquea `alumnos`, `solicitudes_inscripcion`, `matriculas`, `clases` ni `pagos`, y
ninguna bloquea la caja antes que otra fila del negocio. La 007 bloquea sus filas y las clases primero y la caja al final
(criterio 26).

### 2.2 Apertura (`POST /api/cajas`)

```
conAcademia(A):
  bloquearActorVigente
  pg_advisory_xact_lock('caja:' || A)
  hoy = hoyEnLima(RELOJ.ahora())
  existente = SELECT … FROM cajas WHERE academia_id = A AND clave_idempotencia = $clave
  si existente: monto igual (como Decimal, PP6 d) → 200 { caja: leerCaja(existente) }; si no → 409 CLAVE_YA_USADA
  abierta = SELECT id, fecha FROM cajas WHERE academia_id = A AND estado = 'ABIERTA'
  si abierta: fecha = hoy → 409 CAJA_YA_ABIERTA; si no → 409 CAJA_PENDIENTE_DE_CIERRE
  si existe caja con fecha = hoy (cerrada) → 409 CAJA_DEL_DIA_CERRADA      (DR-1)
  INSERT cajas (fecha = hoy, estado ABIERTA, monto_inicial, abierta_por, abierta_en = ahora, clave)
  auditoría CAJA_ABIERTA
  201 { caja }
```

Un 23505 que llegue igual (por ejemplo, una escritura fuera del bloqueo consultivo) se traduce con
`restriccionDeUnicidadViolada` después del `ROLLBACK`: `cajas_una_abierta_por_academia` → `CAJA_YA_ABIERTA`;
`cajas_academia_id_fecha_key` → `CAJA_DEL_DIA_CERRADA`; la de la clave → se relee en otra transacción y responde el 200
de la clave repetida o `CLAVE_YA_USADA`. Nunca 500 (regla «El 409 de un choque» de 004).

### 2.3 Egreso (`POST /api/cajas/{id}/egresos` → `registrarEgresoEnCaja`)

```
conAcademia(A):
  bloquearActorVigente
  id no es UUID → 404
  caja = SELECT … FROM cajas WHERE academia_id = A AND id = $id FOR UPDATE; no existe → 404
  previo = movimiento con clave_idempotencia = $clave en A
  si previo: misma caja y mismos datos → 200 { movimiento: previo, caja }; si no → 409 CLAVE_YA_USADA
  caja.estado = CERRADA → 409 CAJA_CERRADA
  esDeOtroDia(caja.fecha, ahora) → 409 CAJA_DE_OTRO_DIA
  resumen = leerResumen(caja)     -- sumas con numeric en SQL, convertidas a Decimal
  monto > resumen.esperado.efectivo → 409 EFECTIVO_INSUFICIENTE { disponible }      (DR-4)
  numero = coalesce(max(numero), 0) + 1 de la caja (seguro: la caja está bloqueada)
  INSERT movimientos_caja (EGRESO, EGRESO_MENOR, EFECTIVO, …)    -- el trigger vuelve a mirar el estado
  auditoría CAJA_EGRESO_REGISTRADO
  201 { movimiento, caja }
```

"Mismos datos" compara la descripción ya recortada, el monto con `montosIguales` y el comprobante normalizado (`null` si
viene vacío). Dos envíos simultáneos con la misma clave se ordenan en la fila de la caja: el segundo encuentra el
movimiento del primero (`ReadCommitted` ve lo confirmado al empezar cada sentencia) y responde 200.

### 2.4 Ingreso de la 007 (`registrarIngresoEnCaja`)

```
  a) caja = SELECT … FROM cajas WHERE academia_id = A AND estado = 'ABIERTA' FOR UPDATE
     no hay → ErrorNegocio 409 SIN_CAJA_ABIERTA
     esDeOtroDia(caja.fecha, ahora) → 409 CAJA_DE_OTRO_DIA { cajaId, fecha }
  b) previo = movimiento con pago_id = $pago en A → si hay: { …previo, repetido: true }
  c) RangeError si monto no es finito, <= 0, > 100000.00 o con más de dos decimales (sin escribir)
     numero = siguiente; INSERT INGRESO; auditoría CAJA_INGRESO_REGISTRADO (ip nula si no hay)
     { id, cajaId, numero, registradoEn, repetido: false }
```

El orden es el de la spec (criterio 24, PP7): el `RangeError` va en c, después de bloquear la caja y de buscar el
`pagoId`, y antes de insertar. Sin caja abierta, un monto inválido da `SIN_CAJA_ABIERTA`; un `pagoId` ya registrado
devuelve su movimiento sin mirar el monto nuevo.

No llama a `bloquearActorVigente` (lo hizo quien llama) ni abre su propia transacción. Lanza `ErrorNegocio`: la 007 lo
deja subir para que `conAcademia` revierta todo.

### 2.5 Resumen

`leerResumen(tx, cajaId)`: una consulta con `sum(monto) FILTER (WHERE tipo = … AND metodo = …)` y `max(numero)`, con
`coalesce(…, 0)` y el resultado como texto (`::text`). `calcularResumen` arma los tres esperados con `Decimal`. La misma
función la usan la caja actual, el egreso (efectivo disponible) y el cierre. Firmas de `calcularResumen` y
`calcularDiferencia` en PP2 de la spec: `calcularResumen` recibe `{ montoInicial, movimientos: { tipo, metodo, monto }[] }`,
así que `leerResumen` le pasa las sumas como movimientos agregados por tipo y método (o los movimientos mismos).

### 2.6 Cierre (`POST /api/cajas/{id}/cierre`)

```
conAcademia(A):
  bloquearActorVigente
  404 por id
  caja FOR UPDATE
  previo = cierre con clave_idempotencia = $clave en A
  si previo: misma caja y mismo monto declarado → 200 { caja }; si no → 409 CLAVE_YA_USADA
  caja.estado = CERRADA → 409 CAJA_CERRADA
  resumen = leerResumen(caja)
  resumen.ultimoMovimiento ≠ ultimoMovimientoVisto → 409 CAJA_CAMBIO { ultimoMovimiento }
  diferencia = declarado − esperado.efectivo
  diferencia ≠ 0 y sin observación → 400 SOLICITUD_INVALIDA (campo observacion)
  numero = coalesce(max(numero), 0) + 1 de los cierres de la caja
  INSERT cierres_caja (foto del resumen, declarado, diferencia, observación,
                       tardio = esCierreTardio(caja.fecha, ahora), movimientos_hasta, cerrado_por, cerrado_en, clave)
  UPDATE cajas SET estado = 'CERRADA', actualizado_en = ahora
  auditoría CAJA_CERRADA
  200 { caja }
```

"Mismo monto declarado" se compara como `Decimal` (`"120"` y `"120.00"` son el mismo, PP6 d); igual en la apertura con
el monto inicial. Dos envíos simultáneos con la misma clave se ordenan en la fila de la caja: el segundo encuentra el
cierre del primero y responde 200 (PP6 f). Un reintento con la clave de un cierre que llega después de una reapertura
también encuentra el cierre previo y responde 200 con la caja abierta, sin volver a cerrarla (PP6 e). En
`CAJA_CERRADA`, `esperado` va como `{ efectivo, yape, transferencia }` (PP5).

Los `CHECK` de `cierres_caja` vuelven a exigir las cuentas: si el código se equivocara, la base rechaza el cierre.

### 2.7 Reapertura (`POST /api/cajas/{id}/reapertura`)

```
conAcademia(A):
  bloquearActorVigente
  404 por id
  pg_advisory_xact_lock('caja:' || A)
  caja FOR UPDATE; no existe → 404
  caja.estado = ABIERTA → 200 { caja } sin escribir
  otra caja ABIERTA en A → 409 HAY_OTRA_CAJA_ABIERTA { cajaId, fecha }
  UPDATE cierres_caja SET reabierto_por, reabierto_en = ahora, motivo_reapertura
    WHERE academia_id = A AND caja_id = $id AND reabierto_en IS NULL      (debe afectar 1 fila)
  UPDATE cajas SET estado = 'ABIERTA'
  auditoría CAJA_REABIERTA (motivo, datosAntes, datosDespues)
  200 { caja }
```

El `UPDATE` a `ABIERTA` que chocara con otra caja abierta (por fuera del bloqueo consultivo) falla con 23505 en
`cajas_una_abierta_por_academia` y se responde `HAY_OTRA_CAJA_ABIERTA`.

### 2.8 Caja del día (`GET /api/cajas/actual`)

Una transacción de lectura: la caja `ABIERTA` de A o, si no hay, la de `fecha = hoy`; después `leerCaja` (resumen,
movimientos con `alumnos` y `usuarios` unidos por la llave compuesta, cierres). Sin bloqueos ni auditoría.

### 2.9 Trigger de la base

```sql
CREATE FUNCTION public.movimientos_caja_solo_caja_abierta() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_estado estado_caja;
BEGIN
  SELECT c.estado INTO v_estado FROM public.cajas c
   WHERE c.academia_id = NEW.academia_id AND c.id = NEW.caja_id FOR SHARE;
  -- Solo si ve la caja (PP1): si no la ve, deciden la llave compuesta (23503) o la RLS (42501).
  IF v_estado IS NOT NULL AND v_estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'La caja no está abierta' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'movimientos_caja_solo_caja_abierta';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movimientos_caja_solo_caja_abierta BEFORE INSERT ON movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_caja_solo_caja_abierta();
```

`FOR SHARE` necesita que el rol tenga `UPDATE` sobre alguna columna de `cajas` (`estado`), que la app ya tiene. Si la caja
no existe o no se ve por RLS (otra academia), `v_estado` queda nulo y el trigger deja pasar la fila: el trigger `BEFORE
INSERT` corre antes que la llave foránea y que el `WITH CHECK` de la RLS, y el criterio 3 exige que respondan ellas
(`23503` para la `caja_id` de otra academia, `42501` para el `INSERT` con la academia de otra en el contexto propio). La
llave compuesta sigue impidiendo un movimiento en una caja inexistente o ajena (PP1 de la spec). La función
no figura en ninguna política, así que las reglas de volatilidad de 001 no la alcanzan; el criterio 124 de 001 la acepta
por ser `SECURITY INVOKER` y fijar solo `search_path`.

### 2.10 Web (006a)

- `useCajaActual()` con la clave `['caja-actual', nombreCorto, usuarioId]` (criterio 28 de 003); las mutaciones invalidan
  esa clave.
- Cada formulario o diálogo genera su `claveIdempotencia` con `crypto.randomUUID()` (`frontend/src/lib/uuid.ts`) al
  abrirse y la conserva en los reintentos; al cerrar el diálogo, la descarta.
- El cierre envía `ultimoMovimientoVisto = caja.resumen.ultimoMovimiento` de la caja que se mostró. La diferencia en vivo
  usa `restarMontos(declarado, esperado.efectivo)` (entradas y salida en PP3 de la spec). Si la observación está vacía o
  solo tiene espacios, el diálogo no envía el campo (PP6 c: la API respondería 400).
- Fechas y horas con `frontend/src/lib/fechas.ts` (Lima); montos con `formatearSoles`.

### 2.11 [006b] Historial y PDF

- **Alcance de la secretaria (DR-9):** `WHERE c.estado = 'ABIERTA' OR c.abierta_por = $yo OR EXISTS (SELECT 1 FROM
  cierres_caja k WHERE k.academia_id = c.academia_id AND k.caja_id = c.id AND k.cerrado_por = $yo)`. Fuera del alcance,
  el detalle y el PDF responden el mismo 404 que una caja de otra academia.
- **PDF:** una transacción corta lee la academia (nombre), la caja, el cierre pedido y sus movimientos (`numero <=
  movimientos_hasta`); se cierra la transacción; después `generarPdfCierre` arma el documento con `pdfkit` (A4, fuente
  Helvetica, `info.CreationDate = cerradoEn`, `info.Title`), lo junta en un `Buffer` y se responde. Los textos pasan por
  una función que reemplaza lo que no es Latin-1 por `?`. Horas en Lima con `@date-fns/tz`. Montos con dos decimales y
  `S/`.
- **Pruebas del PDF:** se extrae el texto del `Buffer` (con una utilidad de prueba que lee los flujos del PDF de
  `pdfkit` sin comprimir en pruebas, o con una dependencia solo de desarrollo, a decidir por el test-writer) y se buscan
  las cadenas del criterio 42.

## 3. Decisiones

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| Cierres en su propia tabla, con la reapertura en la misma fila (D1) | Campos de cierre en `cajas` (sección 9.1) | La reapertura borraría el primer cierre y su PDF |
| `numero` por caja, asignado con la caja bloqueada (D2) | Orden por `registrado_en` | Puede repetirse; además `numero` dice qué vio quien cierra |
| `ultimoMovimientoVisto` en el cierre (D3, DT-6) | El esperado mostrado | No serviría si algún día se adopta el arqueo ciego (DR-7) |
| Caja en la dirección del egreso y del cierre (D4) | La caja abierta implícita | El egreso nunca cae en otra caja que la de la pantalla |
| Clave del cliente en apertura, egreso y cierre; `pago_id` en el ingreso (D5) | 409 en el segundo clic | Un reintento con respuesta perdida debe ver lo ya hecho |
| Trigger contra movimientos en caja cerrada (D6, DT-4) | Solo el bloqueo de la API | Defensa en profundidad, como los `CHECK` de 004 |
| El trigger rechaza solo si ve la caja y no está `ABIERTA` (PP1) | Rechazar también si no la ve (`IS DISTINCT FROM`) | El criterio 3 exige `23503` y `42501`, y el trigger corre antes que la llave foránea y la RLS |
| `RangeError` del ingreso en el paso c, después de bloquear la caja y buscar el `pagoId` (PP7) | Validar el monto antes de tocar la base | Es el orden aprobado en la spec (criterio 24) |
| Bloqueo consultivo de la academia en apertura y reapertura | Solo los índices únicos | Orden fijo de los 409 y sin 500 en la carrera |
| `REABRIR_CAJA` en la matriz (DT-1) | Rol comprobado en el servicio | El guard decide y la web usa `puede` |
| PDF bajo pedido (DT-2) | PDF guardado en `AlmacenArchivos` | Sin archivos ni confirmación incierta; el cierre no cambia |
| `metodo_pago` creado aquí | Que lo cree la 007 | Los movimientos lo necesitan ya; la 007 lo reutiliza |
| `pago_id` sin llave foránea hasta la 007 | Crear `pagos` vacía | Cada historia crea sus tablas (D-17) |

## 4. Migraciones

- **`<marca>_caja` (006a):** comprobación del rol `aquagestion_app` (como las anteriores); tipos `estado_caja`,
  `tipo_movimiento_caja`, `concepto_movimiento_caja` y `metodo_pago`; tablas `cajas`, `movimientos_caja` y
  `cierres_caja` con sus `CHECK`, llaves compuestas (`RESTRICT`) e índices (spec, "Cambios al modelo de datos"); función
  y trigger del criterio 6; RLS activada y forzada con sus políticas; privilegios del criterio 2.
- **[006b]:** ninguna.
- No se edita ninguna migración aplicada. La base de la PC del responsable solo necesita `npm run db:migrar` (no hay roles
  ni bases nuevos).

## 5. Riesgos

- **Deadlocks con la 007.** Mitigación: el orden de bloqueos de 2.1, la prueba del criterio 26 y la regla en
  `docs/arquitectura.md`. El adversarial debe atacarlo.
- **Una fila caliente por academia.** Cada cobro y egreso espera a los demás de su academia unos milisegundos. Aceptado.
- **`FOR SHARE` del trigger dentro de una transacción que ya tiene `FOR UPDATE`:** es la misma transacción, no se
  bloquea. Lo cubre la prueba del criterio 6 y todas las del egreso.
- **El 23505 de la clave repetida en una carrera fuera del bloqueo:** se resuelve releyendo en otra transacción, como el
  envío de la 005a; si la relectura falla, 409 `CLAVE_YA_USADA`, nunca 500.
- **Montos en la web.** `restarMontos` en céntimos con `bigint`; prohibido `Number` sobre montos (lo revisa el revisor).
- **[006b] `pdfkit` y sus dependencias** (`fontkit`, `linebreak`…): JavaScript puro; la integración continua en Windows
  lo instala igual. Hay que revisar que ninguna esté en la lista negra del criterio 129 de 001.
- **[006b] PDF grande:** una caja con cientos de movimientos genera varias páginas en memoria; para el volumen de una
  academia es poco. Aceptado.
