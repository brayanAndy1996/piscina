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
  - `dominio/esperado.ts` (`calcularResumen`, y `calcularDiferencia`, que devuelve la diferencia y el resultado `CUADRA`,
    `SOBRANTE` o `FALTANTE`; PP2 de la spec) y `dominio/dia.ts`
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

- `packages/contratos/src/caja.ts`: `filtroHistorialCajasSchema`, `cajaHistorialSchema`, `respuestaHistorialCajasSchema`
  (`{ desde, hasta, cajas }`) y `LIMITES_HISTORIAL_CAJAS` (PQ3, PQ4 y PQ13 de la spec).
- `packages/contratos/src/dinero.ts`: recibe `formatearSoles` (hoy en `frontend/src/lib/dinero.ts`, que pasa a
  reexportarla), para la web y el PDF (PQ10).
- `backend/src/modulos/caja/historial.service.ts` (lista, detalle y lectura de los datos del PDF, con el alcance de
  PQ2), `pdf/cierre-pdf.ts` (`generarPdfCierre(datos): Promise<Buffer>`, pura respecto de la base; `GeneradorPdfCierre`,
  `GENERADOR_PDF_CIERRE`; PQ8), `pdf/texto-pdf.ts` (`textoParaPdf`, PQ11) y las rutas `GET` del historial en
  `CajasController`, después de `actual`. `CajaModule` provee `GENERADOR_PDF_CIERRE`; `caja/index.ts` lo reexporta.
  Desde la ronda adversarial 1 de la 006b (2.12) se suman: `pdf/cola-pdf.ts` (`ColaPdfCierre`, `LIMITES_PDF_CIERRE`),
  el generador sin bloquear el bucle (por tramos o con un worker) y el middleware que responde 404 a `HEAD` en
  `/api/cajas`.
- `backend/package.json`: `pdfkit` y `@types/pdfkit`; `scripts/lib/dependencias-backend.mjs`
  (`DEPENDENCIAS_BACKEND_PERMITIDAS`, criterio 127 de 001).
- `frontend/src/modulos/caja/`: `PaginaHistorialCajas.tsx`, `DetalleCaja.tsx`, las llamadas nuevas en `api.ts` (lista,
  detalle y descarga) y sus consultas en `hooks.ts`; el texto de `DialogoReapertura.tsx` para una caja de un día
  anterior; rutas `/panel/cajas` y `/panel/cajas/:id` y opción "Historial de caja" (PQ12).

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

**Ronda adversarial 1 (criterios 47 y 48).**

- **Comprobante (criterio 47), en `packages/contratos/src/`:** el comprobante pasa a rechazar `BIDI_O_SEPARADORES` como
  `textoVisibleSchema` y a normalizar a `null` lo que no tiene visibles (`contarVisibles(valor) === 0`, que incluye
  `""`). Orden dentro del esquema: `trim` → controles → dirección y separadores → máximo 60 → `transform` a `null`. Para
  no copiar la expresión, `texto.ts` exporta una función pequeña (por ejemplo `tieneBidiOSeparadores(texto)`, junto a
  `tieneControles`) que usan `textoVisibleSchema` y el comprobante; `BIDI_O_SEPARADORES` no cambia.
- **Interfaz del egreso (criterio 48 a y b):** `registrarEgresoEnCaja` empieza validando con los mismos esquemas de la
  ruta: `registrarEgresoSchema.shape.descripcion`, `.shape.comprobante` y `.shape.claveIdempotencia` (o los esquemas
  que el contrato exporte para eso), `PATRON_UUID` para `usuarioId` y `validarMonto` como hoy. Con un `safeParse` que
  falla, `RangeError` (sin el valor en el mensaje, para no llevar texto del usuario a los registros). Desde ahí trabaja
  solo con los valores normalizados que devolvió el esquema: el `INSERT`, `datosDespues` y "mismos datos".
- **Interfaz del ingreso (criterio 48 c):** antes de `bloquearCajaAbierta`, `PATRON_UUID` en `alumnoId`, `pagoId` y
  `usuarioId`, y la lista del contrato (`CONCEPTOS_MOVIMIENTO` sin `EGRESO_MENOR`, `METODOS_PAGO`) en `concepto` y
  `metodo`. `validarMonto` se queda en el paso c (PP7).

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

Antes de a, la forma de las entradas (criterio 48 c, ronda adversarial 1): `RangeError` si `alumnoId`, `pagoId` o
`usuarioId` no tienen forma de UUID, o si `concepto` o `metodo` no son de su lista; sin tocar la base.

El `INSERT` toma un `FOR KEY SHARE` implícito sobre la fila del alumno (llave compuesta) y sobre la de `usuarios`
(`registrado_por`), con la caja ya bloqueada. Por eso quien llama bloquea antes la fila del alumno o cliente y pasa como
`usuarioId` al actor ya bloqueado (spec, "Reglas para las historias siguientes", nota de la ronda adversarial 1).

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

Las reglas exactas están en las precisiones PQ1 a PQ15 de la spec (al final de la sección I); aquí, solo el cómo.

- **Lecturas sin bloqueos:** las tres rutas leen en un `conAcademia` de la academia de la sesión, sin
  `bloquearActorVigente`, sin `FOR UPDATE` y sin auditoría (PQ1). "Hoy" sale de `RELOJ` en Lima.
- **Alcance (PQ2, DR-9 y DR-13):** el servicio toma el alcance de `MATRIZ_PERMISOS.VER_REPORTES_FINANCIEROS[rol]`.
  Con `TODO`, sin condición; con `SU_CAJA`, `AND (c.abierta_por = $yo OR c.estado = 'ABIERTA' OR c.fecha = $hoy OR
  EXISTS (SELECT 1 FROM cierres_caja k WHERE k.academia_id = c.academia_id AND k.caja_id = c.id AND k.cerrado_por =
  $yo))` (`c.fecha = $hoy` es PQ2 d, DR-13); con cualquier otro valor, `AND false`. Una sola función arma
  la condición para la lista, el detalle y el PDF. Fuera del alcance, el detalle y el PDF responden el mismo
  `noEncontrado()` que una caja de otra academia.
- **Lista (PQ3, PQ4):** el controlador lee `desde` y `hasta` crudos de la dirección como `estadoCrudo` de
  `solicitudes.controller.ts` (un arreglo si se repiten o llevan corchetes) y los valida con `filtroHistorialCajasSchema`;
  el servicio aplica los valores por defecto con `RELOJ` y vuelve a comprobar el rango (con un solo valor, el otro sale
  del valor por defecto), con días de calendario (`AAAA-MM-DD` a días desde una época, sin `Date` local ni `TZ`). Una
  sola consulta con `sum(...) FILTER (...)` por caja y el último cierre con `DISTINCT ON` o una subconsulta lateral;
  montos como `::text` y `resultado` con `calcularDiferencia`.
- **Detalle (PQ5):** `leerCaja` dentro de la misma transacción que comprueba el alcance.
- **PDF (PQ6 a PQ11):** el servicio, después del permiso, valida la forma del id (`PATRON_UUID`) y del `numero`
  (`^[1-9][0-9]{0,4}$` y `<= 32767`) sin tocar la base (si no, `noEncontrado()`); una transacción corta lee la caja (con el alcance), el
  cierre pedido y sus movimientos (`numero <= movimientos_hasta`, por `numero`), con los nombres; se sale de la
  transacción; después `GENERADOR_PDF_CIERRE.generar(datos)` arma el documento con `pdfkit` (A4, Helvetica,
  `info.CreationDate = cerradoEn`, `info.Title = 'Cierre de caja AAAA-MM-DD N'`), lo junta en un `Buffer` completo y
  recién entonces se escriben las cabeceras (`res.type('application/pdf')`, `Content-Disposition`) y el cuerpo. Si
  `generar` falla, el error sube antes de escribir nada y el filtro global responde el 500 JSON. Los textos pasan por
  `textoParaPdf` (NFC y todo lo que no esté en U+0020–U+007E o U+00A0–U+00FF, `?`). Horas en Lima con `@date-fns/tz`;
  montos con `formatearSoles` (de `packages/contratos`). `DatosPdfCierre` lleva el nombre de la academia
  (`sesion.academia.nombre`), la caja (fecha, monto inicial, quién abrió y a qué hora), el cierre (la fila completa,
  con la reapertura y los nombres) y los movimientos; nada de DNI.
- **Determinismo (PQ9 d):** con `info.CreationDate` fijo, el `/ID` de `pdfkit` sale de la información del documento; si
  no fuera así en la versión instalada, se fija a partir del id de la caja y el número del cierre.
- **Pruebas del PDF:** `backend/test/utilidades/pdf.ts` (sin dependencias nuevas) descomprime los flujos con
  `node:zlib`, extrae las cadenas de `Tj` y `TJ` y las pasa de WinAnsi a Unicode; las pruebas buscan las cadenas de PQ10.
  El PDF de producción conserva la compresión por defecto de `pdfkit`.

### 2.12 [006b] Ronda adversarial 1: el PDF sin detener la API y `HEAD` (criterios 49 y 50)

**El PDF sin bloquear el bucle de eventos (criterio 49 a y d).** Hoy `generarPdfCierre` dibuja todo el documento de una
vez en el hilo principal, a unos 0,65 ms por movimiento. La técnica la elige quien implementa, con dos condiciones:
`generarPdfCierre(datos): Promise<Buffer>`, `GeneradorPdfCierre` y `GENERADOR_PDF_CIERRE` quedan como en PQ8, y salen
los mismos bytes (PQ9 d). Hay dos técnicas válidas.

- **Por tramos en el hilo principal.**
  - **Cómo:** `dibujar` pasa a ser asíncrona. Dentro de la tabla, cede el bucle con
    `await new Promise((r) => setImmediate(r))` cada vez que pasaron unos 10 ms, medidos con `performance.now()`.
  - **Por qué tramos de 10 ms:** en cada vuelta del bucle corre un tramo de cada generación en curso, que son hasta 2
    (criterio 49 b). Cada ida y vuelta a la base de otra petición espera, en el peor caso, la suma de esos tramos. Un
    egreso hace unas 10 a 15 idas y vueltas (sesión, transacción, actor, caja, inserción, auditoría, lectura). Con
    tramos de 10 ms son unos 300 ms y cumple el segundo del 49 a. Con tramos de 50 ms, o con un número fijo de filas
    grande, no cumpliría. Por eso conviene medir por tiempo y no por filas.
  - **Bytes:** las llamadas a `pdfkit` son las mismas y en el mismo orden, así que los bytes no cambian.
  - **Ventaja:** no toca el build ni las pruebas.
  - **Límite:** toda la CPU sigue en el hilo principal. Con 2 PDF en curso, las demás peticiones van más lentas, pero
    no se detienen.
- **En un `worker_thread`.**
  - **Reparto del trabajo:** el hilo principal arma todos los textos (`textoParaPdf`, `formatearSoles`, fechas y horas
    de Lima con `@date-fns/tz`) y le pasa al worker solo cadenas y números. El worker solo llama a `pdfkit` y devuelve
    el `Buffer`, transferido sin copiar. Con eso, la `TZ` del worker no importa.
  - **Cuidado con Vitest:** ejecuta las fuentes TypeScript con su propio cargador, y un worker no lo hereda. El archivo
    del worker tiene que ser JavaScript que Node cargue sin transformar, por ejemplo un `cierre-pdf.worker.cjs` que solo
    hace `require('pdfkit')`. Si no, el worker no arranca en las pruebas, incluidas las unitarias de `cierre-pdf.test.ts`.
  - **Cuidado con el build CommonJS:** no hay `import.meta.url`. La ruta del worker se arma con
    `path.join(__dirname, …)`, y el `.cjs` se copia a `dist/` (con `assets` de `nest-cli.json` o con un paso del build
    escrito en Node, sin `cp`). Hay que comprobarlo con `npm run build` y arrancando `dist/`, también en la integración
    continua de Windows.
  - **Cuántos workers:** como mucho 2, uno por cada turno del criterio 49 b. Si el worker lanza, sale o termina con
    error, la promesa se rechaza y la descarga responde 500 (PQ9 b).
  - **Ventaja:** paralelismo real.
  - **Costo:** un archivo fuera de TypeScript y un paso más en el build.

**Recomendación del especificador:** por tramos medidos por tiempo, porque es el cambio más chico. Si la prueba del 49 a
no tiene margen en la integración continua de Windows, el worker. La lectura de 5 000 filas y el armado de
`DatosPdfCierre` también corren en el hilo principal, y cuentan en la medición, pero son milisegundos. Si se notan,
conviene leer solo las columnas que usa el PDF.

**La cola de generación (criterio 49 b y c).**

- **Dónde vive:** un proveedor de Nest con una sola instancia por proceso, por ejemplo `ColaPdfCierre` en
  `pdf/cola-pdf.ts`, sin dependencias nuevas. Lleva tres cosas: el número de generaciones en curso, una fila de espera
  en orden de llegada (promesas con su `resolve`) de como mucho `enEspera` lugares, y un `Map<usuarioId, número>` con lo
  que cada persona tiene en curso o en espera. La constante `LIMITES_PDF_CIERRE = { simultaneos: 2, enEspera: 8 }` va
  en el mismo archivo.
- **Cómo la usa `HistorialService.pdf`:**
  1. valida la forma del id y del `numero` (404);
  2. pide el turno con `await cola.turno(usuarioId)`, que lanza `HttpException(429)` y el filtro lo convierte en
     `DEMASIADAS_SOLICITUDES`;
  3. dentro de un `try … finally`, lee en su `conAcademia`, sale y llama a `this.generador.generar`;
  4. en el `finally` libera el turno, también con un 404 o un 500.
- **El límite envuelve la llamada del servicio,** no el generador real, para que valga también con el generador de las
  pruebas.
- **Opcional, no exigido:** si el cliente cierra la conexión mientras espera (`solicitud.on('close')`), sacarlo de la
  fila.

**`HEAD` en las rutas de la caja (criterio 50).**

- **Cómo:** un middleware de Express, instalado después de la protección de las rutas de academia (así, sin sesión
  responde lo mismo que `PATCH`) y antes de que Nest registre sus rutas.
- **Qué intercepta:** los `HEAD` cuya ruta coincide, sin distinguir mayúsculas, con `^/api/cajas(?:/.*)?$` (barra
  final incluida). Responde con `responderError(filtro, noEncontrado(), …)`, el mismo JSON y las mismas cabeceras del
  404 de siempre.
- **Comentarios:** el de `CajasController` (PQ15) se actualiza.

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
| Las interfaces validan sus entradas y lanzan `RangeError` antes de tocar la base (criterio 48, ronda adversarial 1) | Confiar en que quien llama validó | La 007 y la 019 escriben dinero por ahí; una entrada mal formada no debe guardarse ni terminar en un error crudo de la base |
| Comprobante sin nada visible → `null` (criterio 47) | Rechazarlo con 400 | Es coherente con el vacío y los espacios, que ya se guardan `null` (DR-3) |
| Bloqueo consultivo de la academia en apertura y reapertura | Solo los índices únicos | Orden fijo de los 409 y sin 500 en la carrera |
| `REABRIR_CAJA` en la matriz (DT-1) | Rol comprobado en el servicio | El guard decide y la web usa `puede` |
| PDF bajo pedido (DT-2) | PDF guardado en `AlmacenArchivos` | Sin archivos ni confirmación incierta; el cierre no cambia |
| [006b] Generador del PDF detrás del token `GENERADOR_PDF_CIERRE` (PQ8) | Simular la falla con `vi.mock('pdfkit')` | Las pruebas de integración reemplazan el proveedor como ya hacen con `RELOJ`, sin depender de cómo se importa `pdfkit` |
| [006b] Respuesta de la lista con el rango aplicado (`{ desde, hasta, cajas }`, PQ3) | Solo `{ cajas }` | La web muestra qué fechas se usaron cuando no se mandó ninguna |
| [006b] Sin paginación en la lista (PQ4) | Paginación o tope de filas | Una caja por día y un rango de como mucho 366 días ya acotan la lista |
| [006b] Fuera del alcance, 404 y no 403 (PQ1) | 403 `SIN_PERMISO` | No revela que la caja existe, igual que con otra academia |
| [006b] Extracción del texto del PDF con `node:zlib` en una utilidad de prueba (PQ10) | Una dependencia de desarrollo para leer PDF | Criterio 127 de 001: cada dependencia nueva se justifica; para buscar cadenas basta leer `Tj` y `TJ` |
| [006b] Acotar el bloqueo y la concurrencia del PDF (criterio 49, DT-7) | Tope de movimientos por caja | Sería una regla de negocio que los documentos no tienen; el límite técnico protege a todas las academias sin cambiar qué se puede registrar |
| [006b] Por tramos o en un worker, a elección (2.12) | Fijar una técnica en la spec | El criterio 49 se mide desde fuera; las dos cumplen y cada una tiene su costo (build o CPU en el hilo principal) |
| [006b] 429 `DEMASIADAS_SOLICITUDES` con la cola llena (criterio 49 b) | 503 con un código nuevo | El 429 ya está en el filtro de errores con su mensaje; un 5xx el filtro lo convierte en `ERROR_INTERNO` y lo registra como error del servidor |
| [006b] Turno antes de la lectura (criterio 49 b) | Leer primero y esperar turno después | La espera no deja una transacción abierta y una cola llena no fuerza a leer miles de filas para responder 429 |
| [006b] Límite por persona en curso o en espera (criterio 49 c, DT-8) | Ventana de tiempo con `ThrottlerStorage` | Una ventana no impide diez descargas a la vez y rompería las pruebas protegidas de PQ6 (más de diez descargas seguidas de una persona) |
| [006b] `HEAD` → 404 con un middleware antes de las rutas (criterio 50) | `@Head()` en el controlador | Con `@Head()` pasaría por el guard: el `ENTRENADOR` recibiría 403 en vez del 404 de `PATCH`, y habría que repetirlo en cada ruta |
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
- **[006b] PDF grande:** al principio se aceptaba, pero la ronda adversarial 1 de la 006b mostró que una caja de 20 000
  movimientos es alcanzable por la API y que su PDF congelaba el proceso. Queda resuelto con el criterio 49: un PDF así
  tarda segundos y espera su turno, pero no detiene a nadie. El documento sigue armándose en memoria; con 2
  generaciones a la vez, son unos pocos MB.
- **[006b] Prueba con tiempos (criterio 49 a):** mide milisegundos contra una base real y puede salir inestable en la
  integración continua de Windows. Los umbrales (200 ms del bucle y 1 000 ms del egreso) son de la spec: no se suben sin
  cambiarla. Si fallan por poco, se cambia la técnica (2.12), no la prueba. El tester la ejecuta varias veces seguidas
  antes de darla por buena.
- **[006b] Nombres de hoy en el PDF de un cierre viejo** (riesgo aceptado de la spec): sin migración no hay dónde
  guardar los nombres del momento del cierre.

## 6. Desviaciones aceptadas (006a)

Lo que se implementó y se aparta de lo escrito en este plan o en la spec. Ninguna cambia una regla de negocio ni un
criterio.

- **Reapertura: `reabierto_en = GREATEST(ahora, cerrado_en)`**, en lugar de `reabierto_en = ahora` (sección 2.7). El
  `CHECK` `cierres_caja_reapertura_posterior` exige `reabierto_en >= cerrado_en`. Si el reloj de quien reabre va unos
  milisegundos atrás respecto del que cerró, o si el servidor corrige su hora, la reapertura tomaría el instante del
  cierre en lugar de fallar con un 500 (comentario en `cajas.service.ts`). La auditoría `CAJA_REABIERTA` y
  `cajas.actualizado_en` usan el mismo valor (`reabiertoEn`), así que coinciden con `cierres_caja.reabierto_en`. Efecto: si
  el cierre es posterior a la hora de la reapertura, `reabierto_en` registra la del cierre. Normalmente la diferencia
  es de milisegundos; con un ajuste grande de la hora del servidor, puede ser más.
- **`esDeOtroDia(fechaCaja, ahora)` es `fechaCaja !== hoyEnLima(ahora)`** (secciones 2.3 y 2.4). La spec define «caja de
  otro día» como la de fecha anterior a hoy (encabezado de «Criterios de aceptación»). Aquí, una caja con fecha futura
  también es «de otro día» y no admite movimientos. Motivo: una fecha futura no puede ser la caja de hoy, y no admitir
  movimientos es lo seguro. Ningún criterio cambia.
- **`REVOKE ALL ON FUNCTION public.movimientos_caja_solo_caja_abierta() FROM PUBLIC`** en la migración (no estaba en la
  sección 2.9). Motivo: sin él, `PUBLIC` tendría `EXECUTE` sobre la función, y el criterio 130 de 001 (privilegios en
  todos los esquemas) lo contaría como privilegio de más. El trigger no lo necesita: la base lo dispara sin comprobar
  `EXECUTE`, y nadie llama la función a mano.
- **Web: caja cerrada de un día anterior.** La API no devuelve una caja cerrada de otro día (`GET /api/cajas/actual`
  devuelve la abierta o la de hoy), así que este estado aparece solo si `/panel/caja` sigue abierta después de la
  medianoche. Entonces `PaginaCaja.tsx` (`cerradaDeOtroDia`) muestra «La caja del {fecha} ya está cerrada. Todavía no hay
  una caja de hoy: ábrela para empezar el día», el formulario de apertura y el resultado de esa caja, y no ofrece
  «Reabrir caja». La reapertura desde la web de un día anterior llega con el historial (006b); la API ya la admite
  (criterio 36). La spec (sección H, criterio 38) no lista este estado. Motivo: no presentar como «de hoy» una caja de
  ayer ni ofrecer una reapertura que la 006a no puede explicar.
- **Archivos de la web que la sección 1 no listaba:** `ResultadoDelCierre.tsx` (el resultado de la caja cerrada),
  `montos.ts` (la diferencia en vivo sobre `restarMontos` y las etiquetas), `api.ts` (las llamadas a la API),
  `mensajes.ts` (el texto de cada 409) y `campos.ts` (el primer mensaje de cada campo de un error de esquema). Son
  presentación y llamadas; no cambian ninguna regla.
