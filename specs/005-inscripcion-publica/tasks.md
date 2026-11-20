# 005 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. La historia se entrega en dos
PR desde esta carpeta (DR-11 de 005, "División en 005a y 005b" de la spec), las dos de ruta crítica y cada una con su
propio rojo, su ataque y su cierre:

- **005a · inscripción, reserva y seguimiento** (primero): criterios 1 a 33, 41 a 45, 47 y 48. Críticos con pruebas
  protegidas: 1 a 10, 12 a 33, 41 y 42. Prueba obligatoria: 11, 43, 44 y 45. Revisor: 47 y 48.
- **005b · foto y panel de solicitudes** (siguiente PR): criterios 34 a 40 y 46, más las partes de 28, 33, 43, 44 y 48
  que tratan de la foto o del panel. Críticos con pruebas protegidas: 34 a 39 y esas partes de 28 y 33. Prueba
  obligatoria: 40 y 46.

Las tareas de la 005b llevan la marca **[005b]** y no se empiezan hasta que la 005a esté unida a `main`. El test-writer
de la 005a no escribe pruebas de la 005b, y las pruebas protegidas de la 005b van en archivos nuevos, sin modificar las
protegidas de la 005a.

## Aprobación

- [x] T0 · responsable y orquestador · Especificación aprobada el 20/11/2026: Bryan aceptó las propuestas N1 a N11
      (DR-1 a DR-11, incluida la división) y el orquestador las técnicas T1 a T9 (DT-1 a DT-9). Ningún valor provisional
      cambió. La 005b queda en esta misma carpeta; `specs/backlog.md` refleja la división.

## 005a · Inscripción, reserva y seguimiento

### Pruebas protegidas (en rojo)

- [ ] T1 · test-writer · Utilidad `backend/test/utilidades/inscripciones.ts` (crear clientes, solicitudes y matrículas
      en una academia, también `VENCIDA` y `CANCELADA` escribiendo las filas como dueño, porque la cancelación por API es
      de la 005b; llenar una clase hasta N; escribir filas inválidas como dueño; un cuerpo de formulario válido de
      ejemplo, sin foto). Pruebas protegidas de las siete tablas completas (también `alumnos.foto_clave` y su privilegio
      de `UPDATE`): catálogo, RLS, llaves compuestas, `CHECK` e índices únicos (incluidos los parciales), privilegios
      exactos de `aquagestion_app`; actualización de las pruebas protegidas de 001 que comparan listas exactas
      (privilegios, tablas, `tipo_actor`) solo para sumar (criterios 1 a 4)
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
      vencen con `RELOJ`, DNI ya registrado y reuso de cliente (con solicitudes vencidas y canceladas escritas como
      dueño), límite por conexión, auditoría sin datos sensibles, correo solo después de confirmar (con un
      `EnviadorCorreo` de prueba que falla y uno que registra), registro técnico en memoria sin datos sensibles al
      cotizar, enviar y consultar, sin la foto (criterios 12 a 17, 19 a 21, 25 a 28)
- [ ] T5 · test-writer · Pruebas protegidas de concurrencia, deterministas (espera comprobada en `pg_locks`): último
      cupo con dos y con diez envíos, envío que espera a una transacción que llena la clase, clases cruzadas sin `40P01`,
      envío frente a `PATCH` de aforo con confirmación y frente a desactivar la clase; mismo DNI a la vez; misma
      `claveIdempotencia` a la vez y repetida; 1000 códigos y tokens distintos (criterios 18, 22 a 24, 41 e, 42)
- [ ] T6 · test-writer · Pruebas protegidas del seguimiento (token, código y DNI, el mismo 404 en todos los casos, vista
      mínima con lista exacta de campos, incluido `fotoCargada` en `false`) y de los límites por IP de las dos lecturas,
      la cotización, el envío y la consulta (cada regla, 429 antes de leer el cuerpo y sin abrir transacción, contadores
      separados), sin el límite de la foto (criterios 29 a 33)
- [ ] T6b · test-writer · Pruebas protegidas de DR-5 en la API: aforo menor que los inscritos con y sin confirmación,
      desactivar con inscritos, reservas vencidas y canceladas que no cuentan, con su auditoría (criterios 41 y 42)
- [ ] T7 · tester · Confirmar que T1 a T6b fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las protegidas de 001 a 004 que no se
      tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit del
      orquestador: "Pruebas protegidas (005a): inscripción pública, cupo, cobro y seguimiento (en rojo)"

### Implementación

- [ ] T8 · backend · Contratos `inscripcion.ts`, `consentimientos.ts` y `solicitudes.ts` (sin los esquemas del panel,
      que son de la 005b; `vistaSolicitudSchema` ya con `fotoCargada`); `telefono` en `academiaPublicaSchema`;
      `confirmarAforoMenor` en `actualizarClaseSchema`; pruebas unitarias de sus bordes (celular, correo, fechas, listas,
      código, unión de la consulta, vista estricta) (criterios 11 a 14, 24, 30 a 32, 41)
- [ ] T9 · backend · `schema.prisma` y migración `<marca>_inscripcion_publica` completa, también lo que usa la 005b
      (`foto_clave`, estados `CANCELADA`): tipos, `PUBLICO`, tablas, `CHECK`, llaves, índices, RLS, políticas,
      privilegios; `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` en el mismo cambio
      (criterios 1 a 4)
- [ ] T10 · backend · `modulos/matriculas`: dominio del cobro con aritmética exacta y `ocupacion.ts` (`contarOcupacion`,
      `contarInscritos`), con pruebas de integración no protegidas de la ocupación (estados, vencimiento, meses)
      (criterios 8 a 10, 20)
- [ ] T11 · backend · `infraestructura/correo` (interfaz, simulado sin destinatario ni enlace, módulo) y actor `PUBLICO`
      en `insercion.ts` (criterios 26, 27)
- [ ] T12 · backend · Límites por IP de las rutas públicas en `instalarProteccionDePrefijos`, sin la regla de la foto
      (criterio 33), y teléfono en `GET /api/a/{nombreCorto}` (criterio 5)
- [ ] T13 · backend · `modulos/inscripciones`: `GET …/inscripcion` y cotización (criterios 6, 7, 11, 15); envío con el
      orden de bloqueos y de errores del plan (sección 6), reuso de cliente, idempotencia, código y token, auditoría y
      correo después de confirmar; prueba no protegida del orden de los 409 (criterios 12 a 28)
- [ ] T14 · backend · Seguimiento: consulta por token y por código y DNI, 404 único, vista mínima con `fotoCargada`
      (criterios 29 a 32)
- [ ] T16 · backend · DR-5 en `ClasesService`: `AFORO_MENOR_QUE_INSCRITOS` con `confirmarAforoMenor` y
      `CLASE_CON_INSCRITOS`, con `contarInscritos` después de `bloquearClasesParaCupo` (criterios 41, 42)
- [ ] T17 · backend · Semilla: clientes, solicitudes y matrículas de ejemplo en `delfines`, repetible, sin tokens en
      claro (criterio 47)
- [ ] T18 · frontend · Rutas públicas, cabecera con teléfono (también en el ingreso), formulario por pasos sin el paso de
      la foto, con cotización, `claveIdempotencia` y manejo de cada 409; página de seguimiento (token y código con DNI)
      con `no-referrer`, sin persistir el token y sin "subir foto"; pruebas de componentes (criterios 43 a 45, partes de
      la 005a). `FormularioClase` no cambia: los dos 409 de DR-5 se ven como cualquier error de la 004
- [ ] T19a · tester · Pruebas protegidas de la 005a en verde y suite completa

### Ataque

- [ ] T20 · adversarial · Atacar los criterios críticos de la 005a con la spec y el código (sin el razonamiento de quien
      implementó): datos de otra academia por nombre corto, `planId`, `claseIds`, token, código y `academiaId` en
      cuerpo, consulta o cabecera; filas escritas directo que se salten RLS o las llaves compuestas; el último cupo con
      envíos, cambios de aforo y desactivaciones simultáneos y cruzados; reservas en el instante exacto del vencimiento;
      el cobro en los bordes de Lima (19:00, fin de mes y de año, otra zona del servidor), con precios con céntimos y
      divisiones periódicas; mes que cambia entre la cotización y el envío; validación con JSON raro (números como
      texto, `null`, Unicode invisible, bidireccionales, fechas imposibles, `__proto__`); edad en el cumpleaños; DNI
      repetido, del personal y de un cliente vencido, a la vez; doble envío y reintentos; tokens y códigos adivinables,
      enumerables o que se distinguen por el tiempo o el cuerpo de la respuesta; datos sensibles en respuestas,
      auditoría y registro técnico; límites por IP (que se salten con mayúsculas, barras finales o `%`-codificación de
      la ruta). Por cada falla: el especificador agrega el criterio a `spec.md`, test-writer la prueba protegida en
      rojo, se corrige y se vuelve a atacar, hasta una ronda sin fallas.

### Revisión y cierre

- [ ] T21 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [ ] T22 · revisor · Comparar con la spec (criterios de la 005a), las reglas de `docs/arquitectura.md` (DT-5 de 002,
      `@Permiso`, `await` en cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles, montos
      sin `number`, fechas en Lima, orden de bloqueos, 409 por nombre de restricción, efectos después de confirmar) y las
      convenciones; verificar la semilla y la documentación de la 005a (criterios 47 y 48)
- [ ] T23 · tester · Suite completa, lint y verificación de tipos
- [ ] T24 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, ocupación, orden de bloqueos,
      `EnviadorCorreo`, límites públicos y las reglas para las historias siguientes, salvo "Archivos"), `README.md` y
      guía de uso (inscripción y seguimiento); notas para la 007 y la 010 en `specs/backlog.md`; 005a como ✅ al unirla
      (criterio 48, parte de la 005a)

### Solo ruta crítica (005a)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas

## 005b · Foto y panel de solicitudes [005b, siguiente PR]

Se empieza con la 005a unida a `main`, en una rama nueva. No necesita migración (la de la 005a ya trae `foto_clave` y
los estados `CANCELADA`).

### Pruebas protegidas (en rojo)

- [ ] T6a · test-writer · **[005b]** Pruebas protegidas de la foto (tipos, firma, tamaño exacto de 5 MB y uno más,
      dimensiones, imagen que no decodifica, recodificación sin EXIF ni GPS ni datos de más, poliglota, estado de la
      solicitud, token ajeno, `fotoCargada` en `true` después de subirla), de `AlmacenArchivos` (claves con `..`,
      absolutas, de otra academia, enlaces simbólicos) y de la atomicidad (transacción que falla borra el archivo nuevo;
      dos subidas a la vez); límite de 10 por hora de la foto, con su contador aparte; registro técnico en memoria sin
      datos sensibles al subir la foto, en un archivo nuevo (criterios 34 a 37 y las partes de la 005b de 28 y 33)
- [ ] T6c · test-writer · **[005b]** Pruebas protegidas del panel: lista por rol y sin datos médicos, aislamiento y
      `?academiaId=`, cancelación que libera el cupo, idempotente, 404 de otra academia, carrera del actor vigente
      (criterios 38 y 39); actualización de la prueba protegida de dependencias permitidas del backend solo para sumar
      `sharp` (criterio 127 de 001)
- [ ] T7b · tester · **[005b]** Confirmar que T6a y T6c fallan por la razón esperada y que las protegidas de 001 a 005a
      siguen pasando. Commit del orquestador: "Pruebas protegidas (005b): foto y panel de solicitudes (en rojo)"

### Implementación

- [ ] T15 · backend · **[005b]** `infraestructura/almacen-archivos` (interfaz y disco local, `ALMACEN_DIRECTORIO` en el
      entorno y en `.env.example`), `sharp` en `backend/package.json` y en `scripts/lib/dependencias-backend.mjs`,
      lector binario de la foto fuera del lector JSON, regla del límite de la foto en `instalarProteccionDePrefijos`,
      `FotoService` y `PUT …/solicitudes/foto` (criterios 33 parte de la foto, 34 a 37)
- [ ] T16b · backend · **[005b]** Contratos del panel (`solicitudPanelSchema`, `respuestaListaSolicitudesSchema`,
      `cancelarSolicitudSchema`, `filtroEstadoSolicitudesSchema`, `respuestaOcupacionSchema`); `GET /api/solicitudes` y
      `POST /api/solicitudes/{id}/cancelar` (criterios 38, 39) y `GET /api/clases/ocupacion` (criterio 40, con prueba
      no protegida de permisos y aislamiento)
- [ ] T18b · frontend · **[005b]** Paso de la foto en el formulario (vista previa, avisos de tipo y tamaño, subida
      después del 201) y "subir foto" en el seguimiento, con reintento; pruebas de componentes (partes de la 005b de 43
      y 44)
- [ ] T19 · frontend · **[005b]** Panel: "Solicitudes de inscripción" (lista, filtro, cancelar con motivo), "Nueva
      inscripción"; ocupación "inscritos / aforo" en la grilla y diálogos de DR-5 en el formulario de clases; pruebas de
      componentes (criterio 46)
- [ ] T19b · tester · **[005b]** Pruebas protegidas en verde y suite completa

### Ataque

- [ ] T20b · adversarial · **[005b]** Atacar 34 a 39: imágenes maliciosas (bombas de descompresión, poliglotas, EXIF,
      tipos cambiados, `Content-Encoding`), rutas y claves de archivo, carreras con la foto y con la cancelación (envío y
      cancelación del mismo cliente, cancelación y `PATCH` de aforo sobre la misma clase), token de otra academia,
      lista y cancelación con ids de otra academia o con roles sin permiso. Mismo ciclo por cada falla, hasta una ronda
      sin fallas.

### Revisión y cierre

- [ ] T21b · orquestador · **[005b]** Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
      (de la 005a ni de la 005b)
- [ ] T22b · revisor · **[005b]** Comparar con la spec (criterios de la 005b) y las reglas; verificar la documentación de
      la 005b (parte de 48)
- [ ] T23b · tester · **[005b]** Suite completa, lint y verificación de tipos, también la integración continua en Windows
      por `sharp`
- [ ] T24b · documentador · **[005b]** Commit, tareas marcadas, `docs/arquitectura.md` (`AlmacenArchivos` y la regla
      "Archivos"), `README.md` y guía de uso (panel de solicitudes y foto), `.env.example` con `ALMACEN_DIRECTORIO`;
      005b y la historia 005 como ✅ al unirla (parte de 48)

### Solo ruta crítica (005b)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
