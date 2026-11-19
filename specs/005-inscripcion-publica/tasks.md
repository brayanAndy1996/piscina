# 005 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. Historia de ruta crítica: los
criterios 1 a 10, 12 a 39, 41 y 42 (provisional, pregunta T3) llevan pruebas protegidas escritas y confirmadas en rojo
antes de implementar (T1 a T7) y ataque adversarial después (T20). Los demás llevan las pruebas que indica cada tarea,
escritas por quien implementa. No se empieza T1 sin la aprobación del responsable (T0).

Si se aprueba la división de la pregunta N11, las tareas marcadas **[005b]** pasan a la historia 005b, con su propio
rojo, su ataque y su cierre; el resto es la 005a.

## Aprobación

- [ ] T0 · responsable y orquestador · Aprobar la especificación y resolver las preguntas N1 a N11 (Bryan) y T1 a T9
      (orquestador). Si alguna respuesta cambia un valor provisional (24 horas de reserva, desde cuándo se cuentan las
      clases, mes en curso, una clase por día, campos obligatorios, DNI ya registrado, consentimientos, límite de 5,
      vista mínima, división), el especificador ajusta los criterios afectados antes de T1. Si se divide, el
      especificador crea `specs/005b-…` con los criterios de la 005b y el orquestador actualiza `specs/backlog.md`.

## Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidad `backend/test/utilidades/inscripciones.ts` (crear clientes, solicitudes y matrículas
      en una academia; llenar una clase hasta N; escribir filas como dueño, también inválidas; un cuerpo de formulario
      válido de ejemplo). Pruebas protegidas de las siete tablas: catálogo, RLS, llaves compuestas, `CHECK` e índices
      únicos (incluidos los parciales), privilegios exactos de `aquagestion_app`; actualización de las pruebas protegidas
      de 001 que comparan listas exactas (privilegios, tablas, `tipo_actor`) solo para sumar (criterios 1 a 4)
- [ ] T2 · test-writer · Pruebas protegidas unitarias del cálculo: `clasesRestantes` en los bordes de Lima (19:00, fin de
      mes, febrero, cinco lunes, cambio de año, `TZ=Asia/Tokyo`), `montoProporcional` con los ejemplos de D-03 y del
      criterio 9 (incluido S/ 200 de 3 clases → S/ 200) y propiedades, `calcularTotal` con ajuste y descuentos; y
      `esMenorDeEdad` en el borde del cumpleaños y del 29 de febrero (criterios 8 a 10, 13)
- [ ] T3 · test-writer · Pruebas protegidas de las rutas de lectura públicas: teléfono en `GET /api/a/{nombreCorto}`
      (y actualización de la prueba protegida del criterio 58 de 001, solo para sumar `telefono`), datos del formulario
      (planes vigentes, clases con cupo, sin entrenador ni aforo), ids, tokens y `academiaId` de otra academia (criterios
      5 a 7)
- [ ] T4 · test-writer · Pruebas protegidas del envío: validación (400), menor y apoderado, consentimientos con evidencia
      y versión, plan y clases válidos, envío correcto con todas sus filas, sin cupo, mes y monto mostrados, reservas que
      vencen con `RELOJ`, DNI ya registrado y reuso de cliente, límite por conexión, auditoría sin datos sensibles, correo
      solo después de confirmar (con un `EnviadorCorreo` de prueba que falla y uno que registra), registro técnico en
      memoria sin datos sensibles (criterios 12 a 17, 19 a 21, 25 a 28)
- [ ] T5 · test-writer · Pruebas protegidas de concurrencia, deterministas (espera comprobada en `pg_locks`): último
      cupo con dos y con diez envíos, envío que espera a una transacción que llena la clase, clases cruzadas sin `40P01`,
      envío frente a `PATCH` de aforo con confirmación y frente a desactivar la clase; mismo DNI a la vez; misma
      `claveIdempotencia` a la vez y repetida; 1000 códigos y tokens distintos (criterios 18, 22 a 24, 41 e, 42)
- [ ] T6 · test-writer · Pruebas protegidas del seguimiento (token, código y DNI, el mismo 404 en todos los casos, vista
      mínima con lista exacta de campos) y de los límites por IP (cada regla, 429 antes de leer el cuerpo y sin abrir
      transacción, contadores separados) (criterios 29 a 33)
- [ ] T6a · test-writer · **[005b]** Pruebas protegidas de la foto (tipos, firma, tamaño exacto de 5 MB y uno más,
      dimensiones, imagen que no decodifica, recodificación sin EXIF ni GPS ni datos de más, poliglota, estado de la
      solicitud, token ajeno), de `AlmacenArchivos` (claves con `..`, absolutas, de otra academia, enlaces simbólicos) y
      de la atomicidad (transacción que falla borra el archivo nuevo; dos subidas a la vez) (criterios 34 a 37)
- [ ] T6b · test-writer · Pruebas protegidas del panel: lista por rol y sin datos médicos, aislamiento y
      `?academiaId=`, cancelación que libera el cupo, idempotente, 404 de otra academia, carrera del actor vigente
      (**[005b]** criterios 38 y 39); DR-5: aforo menor con y sin confirmación y desactivar con inscritos, con su
      auditoría (criterios 41 y 42)
- [ ] T7 · tester · Confirmar que T1 a T6b fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las protegidas de 001 a 004 que no se
      tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit del
      orquestador: "Pruebas protegidas (005): inscripción pública, cupo, cobro y seguimiento (en rojo)"

## Implementación

- [ ] T8 · backend · Contratos `inscripcion.ts`, `consentimientos.ts` y `solicitudes.ts`; `telefono` en
      `academiaPublicaSchema`; `confirmarAforoMenor` y `respuestaOcupacionSchema` en `clases.ts`; pruebas unitarias de
      sus bordes (celular, correo, fechas, listas, código, unión de la consulta, vista estricta) (criterios 11 a 14, 24,
      30 a 32)
- [ ] T9 · backend · `schema.prisma` y migración `<marca>_inscripcion_publica` (tipos, `PUBLICO`, tablas, `CHECK`,
      llaves, índices, RLS, políticas, privilegios); `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y
      `TABLAS_DESPUES_DE_MIGRAR` en el mismo cambio (criterios 1 a 4)
- [ ] T10 · backend · `modulos/matriculas`: dominio del cobro con aritmética exacta y `ocupacion.ts` (`contarOcupacion`,
      `contarInscritos`), con pruebas de integración no protegidas de la ocupación (estados, vencimiento, meses)
      (criterios 8 a 10, 20)
- [ ] T11 · backend · `infraestructura/correo` (interfaz, simulado sin destinatario ni enlace, módulo) y actor `PUBLICO`
      en `insercion.ts` (criterios 26, 27)
- [ ] T12 · backend · Límites por IP de las rutas públicas en `instalarProteccionDePrefijos` (criterio 33) y teléfono en
      `GET /api/a/{nombreCorto}` (criterio 5)
- [ ] T13 · backend · `modulos/inscripciones`: `GET …/inscripcion` y cotización (criterios 6, 7, 11, 15); envío con el
      orden de bloqueos y de errores del plan (sección 6), reuso de cliente, idempotencia, código y token, auditoría y
      correo después de confirmar; prueba no protegida del orden de los 409 (criterios 12 a 28)
- [ ] T14 · backend · Seguimiento: consulta por token y por código y DNI, 404 único, vista mínima (criterios 29 a 32)
- [ ] T15 · backend · **[005b]** `infraestructura/almacen-archivos` (interfaz y disco local, `ALMACEN_DIRECTORIO` en el
      entorno y en `.env.example`), `sharp` en `backend/package.json` y en `scripts/lib/dependencias-backend.mjs`,
      lector binario de la foto fuera del lector JSON, `FotoService` y `PUT …/solicitudes/foto` (criterios 34 a 37)
- [ ] T16 · backend · Panel: **[005b]** `GET /api/solicitudes` y `POST /api/solicitudes/{id}/cancelar` (criterios 38,
      39) y `GET /api/clases/ocupacion` (criterio 40, con prueba no protegida de permisos y aislamiento); DR-5 en
      `ClasesService` (criterios 41, 42)
- [ ] T17 · backend · Semilla: clientes, solicitudes y matrículas de ejemplo en `delfines`, repetible, sin tokens en
      claro (criterio 47)
- [ ] T18 · frontend · Rutas públicas, cabecera con teléfono (también en el ingreso), formulario por pasos con
      cotización, `claveIdempotencia` y manejo de cada 409; página de seguimiento (token y código con DNI) con
      `no-referrer` y sin persistir el token; pruebas de componentes (criterios 43 a 45). La subida de la foto en el
      formulario y en el seguimiento es **[005b]**
- [ ] T19 · frontend · Panel: **[005b]** "Solicitudes de inscripción" (lista, filtro, cancelar con motivo), "Nueva
      inscripción"; ocupación "inscritos / aforo" en la grilla y diálogos de DR-5 en el formulario de clases; pruebas de
      componentes (criterio 46)
- [ ] T19a · tester · Pruebas protegidas en verde y suite completa

## Ataque

- [ ] T20 · adversarial · Atacar los criterios críticos con la spec y el código (sin el razonamiento de quien
      implementó): datos de otra academia por nombre corto, `planId`, `claseIds`, token, código, `academiaId` en cuerpo,
      consulta o cabecera, y claves de archivo; filas escritas directo que se salten RLS o las llaves compuestas; el
      último cupo con envíos, cancelaciones, cambios de aforo y desactivaciones simultáneos y cruzados; reservas en el
      instante exacto del vencimiento; el cobro en los bordes de Lima (19:00, fin de mes y de año, otra zona del
      servidor), con precios con céntimos y divisiones periódicas; mes que cambia entre la cotización y el envío;
      validación con JSON raro (números como texto, `null`, Unicode invisible, bidireccionales, fechas imposibles,
      `__proto__`); edad en el cumpleaños; DNI repetido, del personal y de un cliente vencido, a la vez; doble envío y
      reintentos; tokens y códigos adivinables, enumerables o que se distinguen por el tiempo o el cuerpo de la
      respuesta; datos sensibles en respuestas, auditoría y registro técnico; límites por IP (que se salten con
      mayúsculas, barras finales o `%`-codificación de la ruta); y, en la 005b, imágenes maliciosas (bombas de
      descompresión, poliglotas, EXIF, tipos cambiados), rutas de archivo y carreras con la foto. Por cada falla: el
      especificador agrega el criterio a `spec.md`, test-writer la prueba protegida en rojo, se corrige y se vuelve a
      atacar, hasta una ronda sin fallas.

## Revisión y cierre

- [ ] T21 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T22 · revisor · Comparar con la spec, las reglas de `docs/arquitectura.md` (DT-5 de 002, `@Permiso`, `await` en
      cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles, montos sin `number`, fechas en
      Lima, orden de bloqueos, 409 por nombre de restricción, efectos después de confirmar) y las convenciones; verificar
      la semilla y la documentación (criterios 47 y 48)
- [ ] T23 · tester · Suite completa, lint y verificación de tipos (también la integración continua en Windows por
      `sharp`)
- [ ] T24 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, ocupación, orden de bloqueos,
      `AlmacenArchivos`, `EnviadorCorreo`, límites públicos y las reglas para las historias siguientes), `README.md`,
      guía de uso y `.env.example`; notas para la 007 y la 010 en `specs/backlog.md` (criterio 48)

## Solo ruta crítica

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
