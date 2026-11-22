# 005 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. La historia se entrega en dos
PR desde esta carpeta (DR-11 de 005, "División en 005a y 005b" de la spec), las dos de ruta crítica y cada una con su
propio rojo, su ataque y su cierre:

- **005a · inscripción, reserva y seguimiento** (primero): criterios 1 a 33, 41 a 45 y 47 a 60. Críticos con pruebas
  protegidas: 1 a 10, 12 a 33, 41, 42 y 49 a 60 (49 a 53, de la ronda 1 del ataque; 54 a 60, de las respuestas del
  responsable a la ronda 1). Prueba obligatoria: 11, 43, 44 y 45. Revisor: 47 (con prueba no protegida desde la ronda
  1) y 48.
- **005b · foto y panel de solicitudes** (siguiente PR): criterios 34 a 40 y 46, más las partes de 28, 33, 43, 44 y 48
  que tratan de la foto o del panel, 61 a 63 (ronda 1 de su ataque) y 64 a 66 (ronda 2). Críticos con pruebas
  protegidas: 34 a 39, esas partes de 28 y 33, 61, 62 y 64 a 66. Prueba obligatoria: 40, 46 y 63.

Las tareas de la 005b llevan la marca **[005b]** y no se empiezan hasta que la 005a esté unida a `main`. El test-writer
de la 005a no escribe pruebas de la 005b, y las pruebas protegidas de la 005b van en archivos nuevos, sin modificar las
protegidas de la 005a.

## Aprobación

- [x] T0 · responsable y orquestador · Especificación aprobada el 20/11/2026: Bryan aceptó las propuestas N1 a N11
      (DR-1 a DR-11, incluida la división) y el orquestador las técnicas T1 a T9 (DT-1 a DT-9). Ningún valor provisional
      cambió. La 005b queda en esta misma carpeta; `specs/backlog.md` refleja la división.

## 005a · Inscripción, reserva y seguimiento

### Pruebas protegidas (en rojo)

- [x] T1 · test-writer · Utilidad `backend/test/utilidades/inscripciones.ts` (crear clientes, solicitudes y matrículas
      en una academia, también `VENCIDA` y `CANCELADA` escribiendo las filas como dueño, porque la cancelación por API es
      de la 005b; llenar una clase hasta N; escribir filas inválidas como dueño; un cuerpo de formulario válido de
      ejemplo, sin foto). Pruebas protegidas de las siete tablas completas (también `alumnos.foto_clave` y su privilegio
      de `UPDATE`): catálogo, RLS, llaves compuestas, `CHECK` e índices únicos (incluidos los parciales), privilegios
      exactos de `aquagestion_app`; actualización de las pruebas protegidas de 001 que comparan listas exactas
      (privilegios, tablas, `tipo_actor`) solo para sumar (criterios 1 a 4)
- [x] T2 · test-writer · Pruebas protegidas unitarias del cálculo: `clasesRestantes` en los bordes de Lima (19:00, fin de
      mes, febrero, cinco lunes, cambio de año, `TZ=Asia/Tokyo`), `montoProporcional` con los ejemplos de D-03 y del
      criterio 9 (incluido S/ 200 de 3 clases → S/ 200) y propiedades, `calcularTotal` con ajuste y descuentos; y
      `esMenorDeEdad` en el borde del cumpleaños y del 29 de febrero (criterios 8 a 10, 13)
- [x] T3 · test-writer · Pruebas protegidas de las rutas de lectura públicas: teléfono en `GET /api/a/{nombreCorto}`
      (y actualización de la prueba protegida del criterio 58 de 001, solo para sumar `telefono`), datos del formulario
      (planes vigentes, clases con cupo, sin entrenador ni aforo), ids, tokens y `academiaId` de otra academia (criterios
      5 a 7)
- [x] T4 · test-writer · Pruebas protegidas del envío: validación (400), menor y apoderado, consentimientos con evidencia
      y versión, plan y clases válidos, envío correcto con todas sus filas, sin cupo, mes y monto mostrados, reservas que
      vencen con `RELOJ`, DNI ya registrado y reuso de cliente (con solicitudes vencidas y canceladas escritas como
      dueño), límite por conexión, auditoría sin datos sensibles, correo solo después de confirmar (con un
      `EnviadorCorreo` de prueba que falla y uno que registra), registro técnico en memoria sin datos sensibles al
      cotizar, enviar y consultar, sin la foto (criterios 12 a 17, 19 a 21, 25 a 28)
- [x] T5 · test-writer · Pruebas protegidas de concurrencia, deterministas (espera comprobada en `pg_locks`): último
      cupo con dos y con diez envíos, envío que espera a una transacción que llena la clase, clases cruzadas sin `40P01`,
      envío frente a `PATCH` de aforo con confirmación y frente a desactivar la clase; mismo DNI a la vez; misma
      `claveIdempotencia` a la vez y repetida; 1000 códigos y tokens distintos (criterios 18, 22 a 24, 41 e, 42)
- [x] T6 · test-writer · Pruebas protegidas del seguimiento (token, código y DNI, el mismo 404 en todos los casos, vista
      mínima con lista exacta de campos, incluido `fotoCargada` en `false`) y de los límites por IP de las dos lecturas,
      la cotización, el envío y la consulta (cada regla, 429 antes de leer el cuerpo y sin abrir transacción, contadores
      separados), sin el límite de la foto (criterios 29 a 33)
- [x] T6b · test-writer · Pruebas protegidas de DR-5 en la API: aforo menor que los inscritos con y sin confirmación,
      desactivar con inscritos, reservas vencidas y canceladas que no cuentan, con su auditoría (criterios 41 y 42)
- [x] T7 · tester · Confirmar que T1 a T6b fallan por falta de la funcionalidad (tablas, rutas, esquemas o funciones
      inexistentes) y no por sintaxis, importaciones o configuración; y que las protegidas de 001 a 004 que no se
      tocaron siguen pasando. Antes del commit, `git diff --cached --stat` solo con archivos de prueba. Commit del
      orquestador: "Pruebas protegidas (005a): inscripción pública, cupo, cobro y seguimiento (en rojo)"

### Implementación

- [x] T8 · backend · Contratos `inscripcion.ts`, `consentimientos.ts` y `solicitudes.ts` (sin los esquemas del panel,
      que son de la 005b; `vistaSolicitudSchema` ya con `fotoCargada`); `telefono` en `academiaPublicaSchema`;
      `confirmarAforoMenor` en `actualizarClaseSchema`; pruebas unitarias de sus bordes (celular, correo, fechas, listas,
      código, unión de la consulta, vista estricta) (criterios 11 a 14, 24, 30 a 32, 41)
- [x] T9 · backend · `schema.prisma` y migración `<marca>_inscripcion_publica` completa, también lo que usa la 005b
      (`foto_clave`, estados `CANCELADA`): tipos, `PUBLICO`, tablas, `CHECK`, llaves, índices, RLS, políticas,
      privilegios; `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` en el mismo cambio
      (criterios 1 a 4)
- [x] T10 · backend · `modulos/matriculas`: dominio del cobro con aritmética exacta y `ocupacion.ts` (`contarOcupacion`,
      `contarInscritos`), con pruebas de integración no protegidas de la ocupación (estados, vencimiento, meses)
      (criterios 8 a 10, 20)
- [x] T11 · backend · `infraestructura/correo` (interfaz, simulado sin destinatario ni enlace, módulo) y actor `PUBLICO`
      en `insercion.ts` (criterios 26, 27)
- [x] T12 · backend · Límites por IP de las rutas públicas en `instalarProteccionDePrefijos`, sin la regla de la foto
      (criterio 33), y teléfono en `GET /api/a/{nombreCorto}` (criterio 5)
- [x] T13 · backend · `modulos/inscripciones`: `GET …/inscripcion` y cotización (criterios 6, 7, 11, 15); envío con el
      orden de bloqueos y de errores del plan (sección 6), reuso de cliente, idempotencia, código y token, auditoría y
      correo después de confirmar; prueba no protegida del orden de los 409 (criterios 12 a 28)
- [x] T14 · backend · Seguimiento: consulta por token y por código y DNI, 404 único, vista mínima con `fotoCargada`
      (criterios 29 a 32)
- [x] T16 · backend · DR-5 en `ClasesService`: `AFORO_MENOR_QUE_INSCRITOS` con `confirmarAforoMenor` y
      `CLASE_CON_INSCRITOS`, con `contarInscritos` después de `bloquearClasesParaCupo` (criterios 41, 42)
- [x] T17 · backend · Semilla: clientes, solicitudes y matrículas de ejemplo en `delfines`, repetible, sin tokens en
      claro (criterio 47)
- [x] T18 · frontend · Rutas públicas, cabecera con teléfono (también en el ingreso), formulario por pasos sin el paso de
      la foto, con cotización, `claveIdempotencia` y manejo de cada 409; página de seguimiento (token y código con DNI)
      con `no-referrer`, sin persistir el token y sin "subir foto"; pruebas de componentes (criterios 43 a 45, partes de
      la 005a). `FormularioClase` no cambia: los dos 409 de DR-5 se ven como cualquier error de la 004
- [x] T19a · tester · Pruebas protegidas de la 005a en verde y suite completa

### Ataque

- [x] T20 · adversarial · Atacar los criterios críticos de la 005a con la spec y el código (sin el razonamiento de quien
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
      _(Hecha: la ronda 1 está en la sección K de la spec, y la ronda 2 es T34, sin fallas.)_

#### Ronda 1 del ataque (005a)

Fallas F1 a F5 y el defecto de la semilla (criterios 49 a 53 y ajuste del 47, sección K de la spec). Las pruebas
protegidas de la ronda van en archivos nuevos (por ejemplo `…-ronda1.test.ts`), sin modificar las protegidas ya
escritas.

- [x] T25 · especificador · Criterios 49 a 53 en `spec.md` (sección K), ajustes de los criterios 12, 19, 27, 28 y 47,
      P10 (llaves primarias con `academia_id`, ya aplicada), AT1-1 a AT1-5, preguntas pendientes R1 a R5 y plan
      (secciones 1, 6, 8, 10, 13 y 14) (criterios 47, 49 a 53)
- [x] T26 · test-writer · Pruebas protegidas en rojo de la ronda 1, desde la spec y los contratos públicos: `HEAD` y
      `GET` en el mismo contador de lectura (60 `HEAD` y un `GET`, 60 `GET` y un `HEAD`, mezcla con la petición 61, el
      mismo 429 para una academia que existe y otra que no, sin tocar los demás contadores) (criterio 49);
      `montoCotizadoSchema` (bordes `"100000"`, `"100000.00"`, `"100000.01"`, `"100001"`), cotización y envío con planes
      de 99999.01 y 99999.99 a mes completo (201 con `monto_calculado` 100000.00) y la propiedad sobre todo precio válido
      (criterio 50); correo colgado, que lanza y que rechaza, con el 201 en menos de 2 s, la llamada después de confirmar,
      un segundo envío sin demora y sin `unhandledRejection` (criterio 51); registro en memoria del fallo del correo con
      errores que llevan el destinatario, el enlace y el token en el mensaje, en propiedades propias, en `cause` y en
      `name`, y con valores que no son `Error` (criterio 52); registro en memoria en `trace` con `Referer` que lleva el
      token en las rutas públicas, en errores 400, 404, 409 y 429 y en una ruta inexistente (criterio 53)
- [x] T27 · tester · Confirmar que T26 falla por la razón esperada (límite que no cuenta `HEAD`, 400 en
      `montoMostrado`, 201 retenido, mensaje o propiedades del error en el registro, `Referer` sin redactar) y no por
      sintaxis, importaciones o configuración; y que las demás protegidas siguen igual. `git diff --cached --stat` solo
      con archivos de prueba. Commit del orquestador: "Pruebas protegidas (005a, ronda 1): HEAD, monto cotizado, correo
      y registro (en rojo)"
- [x] T28 · backend · `HEAD` como `GET` al elegir la regla de `LIMITES_PUBLICOS` en `instalarProteccionDePrefijos`, con
      la misma clave del almacén (criterio 49; plan, sección 8)
- [x] T29 · backend · `MONTO_COTIZADO_MAXIMO` y `montoCotizadoSchema` en `packages/contratos/src/dinero.ts`, con pruebas
      unitarias de sus bordes; `montoMostrado` de `enviarInscripcionSchema` con ese esquema; sin tocar `montoSchema` ni
      `MONTO_MAXIMO` (criterios 12, 19 y 50; plan, sección 1)
- [x] T30 · backend · Correo sin esperar (`enviarSinEsperar`) y registro del fallo solo con `tipoDeError`, sin
      `errorParaRegistro` (criterios 27, 51 y 52; plan, sección 10)
- [x] T31 · backend · `req.headers.referer` en `RUTAS_REDACTADAS` y ajuste de la prueba no protegida
      `opciones-registro.test.ts` (largo 4) (criterios 28 y 53; plan, sección 14)
- [x] T32 · backend · Semilla: Básico martes, miércoles y jueves a las 18:00 con el entrenador `10000005`; clientes de
      ejemplo con lunes, miércoles y viernes y `monto_calculado` de `montoProporcional`; prueba no protegida de la
      semilla con un envío 201 por cada plan de ejemplo (`RELOJ` en el día 1 del mes en curso); las pruebas de la
      semilla de 002 y 004 siguen pasando (criterio 47; plan, sección 13)
- [x] T33 · tester · Pruebas protegidas de la 005a (también las de la ronda 1) en verde y suite completa

#### Respuestas del responsable a la ronda 1 (005a)

DR-12 a DR-16 del 20/11/2026 (criterios 54 a 60 y ajuste del 47 d, sección L de la spec). Las pruebas protegidas nuevas
van en archivos nuevos (por ejemplo `…-respuestas-ronda1.test.ts`); la única protegida existente que cambia es la del
criterio 32 para `VENCIDA` y `CANCELADA` ("Impacto en especificaciones anteriores"). Se pueden hacer junto con T26 a
T33 o después; T34 ataca todo.

- [x] T35 · especificador · Criterios 54 a 60 (sección L), ajustes de 16, 25, 27, 32, 33, 44 y 47 d, DR-12 a DR-16,
      AT1-6 a AT1-10, riesgos aceptados (regreso por un tercero, IPv6 por /64), pregunta R6, R5 trasladada a la 007 en
      `specs/backlog.md`, y plan (secciones 1, 2, 3, 6, 7, 8, 10, 12, 13 y 15) (criterios 47 y 54 a 60)
- [x] T36 · test-writer · Pruebas protegidas en rojo, desde la spec y los contratos públicos:
      `vencimientoDeReserva` con los instantes del criterio 54 (a a h, en `TZ=Asia/Tokyo` y `TZ=UTC`) y la integración
      del 30 y del 29 de noviembre (201, matrícula, auditoría y seguimiento) (criterio 54); fin de mes con `RELOJ`: un
      milisegundo antes y en el instante, regreso con el mismo DNI el 1 de diciembre, límite por conexión antes y
      después de medianoche, nada de noviembre en la ocupación de diciembre (criterio 55); `CHECK
      matriculas_reserva_dentro_del_mes` como app y como dueño, en `INSERT` y `UPDATE`, con `SET TIME ZONE` distinto y en
      diciembre (criterio 56); destinatarios del enlace con un `EnviadorCorreo` que registra (a a g, también colgado y
      fallando a la vez) (criterio 57); vista reducida por token y por código con DNI, regreso por un tercero con
      "Valeria" e "Intrusa", y `vistaSolicitudSchema` (criterio 58); `claveDeConexion` con todas las formas del criterio
      59 y límites por /64 y por IPv4 mapeada en lecturas, cotización, envío y consulta, con la opción de la utilidad que
      fija la IP por `X-Forwarded-For` (plan, sección 15) (criterio 59); límite de 5 por /64, mapeada, filas escritas
      como dueño y dos envíos simultáneos desde el mismo /64 (criterio 60). Además, ajustar en
      `backend/test/integracion/inscripciones/seguimiento.test.ts` solo la prueba "criterio 32: una solicitud VENCIDA o
      CANCELADA muestra lo mismo sin reservaVenceEn" para exigir la vista reducida (sin `nombres` ni `fotoCargada`), con
      la aprobación del orquestador
- [x] T37 · tester · Confirmar que T36 falla por la razón esperada (función o `CHECK` inexistentes, vencimiento de 24
      horas que cruza el mes, un solo correo, `nombres` en la vista reducida, límites por dirección exacta) y no por
      sintaxis, importaciones o configuración; que las demás protegidas siguen igual; y que el único cambio en una
      protegida existente es el de `seguimiento.test.ts` descrito en T36. `git diff --cached --stat` solo con archivos
      de prueba. Commit del orquestador: "Pruebas protegidas (005a, respuestas de la ronda 1): reserva hasta fin de mes,
      correo al apoderado, vista reducida e IPv6 (en rojo)"
- [x] T38 · backend · `matriculas/dominio/reserva.ts` (`finDelMesEnLima`, `vencimientoDeReserva`) con pruebas unitarias
      no protegidas de apoyo; el envío la usa para `reserva_vence_en`; migración `<marca>_reserva_dentro_del_mes` con el
      `CHECK` (criterios 16, 54 a 56; plan, secciones 2, 3 y 6)
- [x] T39 · backend · Destinatarios del enlace: `destinatariosDelEnlace` y un `enviarSinEsperar` por cada uno
      (criterios 27 y 57; plan, sección 10)
- [x] T40 · backend · Vista reducida en `SeguimientoService` y `vistaSolicitudSchema` como unión por estado; ajuste de la
      prueba no protegida `packages/contratos/src/solicitudes.test.ts` (criterios 32 y 58; plan, secciones 1 y 7)
- [x] T41 · backend · `comun/http/conexion.ts` (`claveDeConexion`) con pruebas unitarias no protegidas de apoyo; clave
      del almacén en `instalarProteccionDePrefijos` para las reglas de `LIMITES_PUBLICOS` (no la del ingreso); bloqueo
      consultivo y conteo del límite por conexión con la clave (criterios 25, 33, 59 y 60; plan, secciones 6 y 8)
- [x] T42 · backend · Semilla: matrículas del mes en curso, reserva vigente hasta `finDelMesEnLima`, vencida en un
      instante anterior; la prueba no protegida de la semilla comprueba que ninguna `reserva_vence_en` pasa del fin de su
      mes (criterio 47 d; plan, sección 13)
- [x] T43 · frontend · `VistaSeguimiento` sin el saludo con el nombre en la vista reducida, con su prueba de componentes
      (criterios 44 y 58; plan, sección 12)
- [x] T44 · tester · Pruebas protegidas de la 005a (también las de T36) en verde, suite completa, lint y verificación
      de tipos

#### Ronda 2 del ataque (005a)

- [x] T34 · adversarial · Ronda 2 sobre los criterios críticos de la 005a, con la spec y el código (sin el
      razonamiento de quien implementó), incluidos 49 a 60: otros métodos (`OPTIONS`, métodos en minúsculas o
      desconocidos) que se salten límites, montos en el borde de 100000.00 y comparaciones de `montoMostrado` con ceros
      de más, proveedores de correo lentos o maliciosos (getters que lanzan, `Proxy`, errores sin prototipo) y otras
      cabeceras que lleven el token al registro; reservas en el último milisegundo del mes, cambio de año y servidores
      en otra zona, y filas que intenten saltarse el `CHECK` del fin de mes; correos del alumno y del apoderado que se
      escriben distinto pero son el mismo, o que colisionan; vistas de seguimiento de solicitudes antiguas que filtren
      datos de la nueva (nombre, foto, plan); `claveDeConexion` con formas raras de IPv6 (`::` al inicio o al final, IPv4
      embebida, zonas, ceros, mayúsculas, textos que no son IP) y envíos simultáneos desde el mismo /64. Mismo ciclo por
      cada falla, hasta una ronda sin fallas.
      _Hecha el 20/11/2026 sobre el commit `cf93533`: sin fallas reproducibles en 49 a 60 ni regresiones en la ruta
      crítica (sección M de la spec). Deja tres riesgos aceptados (IPv6 con un bloque mayor que /64, reintento con la
      reserva vencida, `tipoDeError`) y la pregunta R7, que no bloquea._
- [x] T46 · especificador · Registro de la ronda 2: sección M, estado, riesgos aceptados nuevos y pregunta R7 en la
      spec; nota operativa de la migración `20261120190000_reserva_dentro_del_mes` y riesgos en el plan; T45; nota R7 en
      las notas de hosting de `specs/backlog.md`

### Revisión y cierre

- [x] T21 · orquestador · Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
- [x] T22 · revisor · Comparar con la spec (criterios de la 005a), las reglas de `docs/arquitectura.md` (DT-5 de 002,
      `@Permiso`, `await` en cada paso, sin caché, errores con `errorParaRegistro`, registro sin datos sensibles, montos
      sin `number`, fechas en Lima, orden de bloqueos, 409 por nombre de restricción, efectos después de confirmar) y las
      convenciones; verificar la semilla y la documentación de la 005a (criterios 47 y 48)
- [x] T23 · tester · Suite completa, lint y verificación de tipos
- [x] T24 · documentador · Commit, tareas marcadas, `docs/arquitectura.md` (tablas, ocupación, orden de bloqueos,
      `EnviadorCorreo`, límites públicos y las reglas para las historias siguientes, salvo "Archivos"), `README.md` y
      guía de uso (inscripción y seguimiento); notas para la 007 y la 010 en `specs/backlog.md`; en el PR, el aviso de
      recrear las bases de desarrollo de la rama sembradas antes del `CHECK` del criterio 56 (T45; plan, "Migraciones");
      005a como ✅ al unirla (criterio 48, parte de la 005a)
      _(Hecha en este commit, salvo el aviso en la descripción del PR (T45) y el ✅ de la 005a al unirla: los pone el orquestador.)_
- [x] T45 · documentador · Nota operativa de la ronda 2 (plan, "Migraciones"): en `docs/guia-local-windows.md`, un
      problema conocido "La migración `20261120190000_reserva_dentro_del_mes` falla con 23514", que explique que pasa en
      una base de desarrollo sembrada con una versión anterior de la rama (reservas de ejemplo a 365 días), que
      `db:preparar` solo no lo arregla y que la solución es "Borrar la base de desarrollo y empezar de cero" (con el
      enlace a esa sección y el aviso de que se pierden los datos de desarrollo); y el mismo aviso en la descripción del
      PR de la 005a, para quien tenga una base de la rama (criterio 48, parte de la 005a)
      _(Guía hecha en este commit. Falta el aviso en la descripción del PR: lo añade el orquestador al abrirlo.)_

### Solo ruta crítica (005a)

- [x] Pruebas escritas por test-writer y confirmadas en rojo
- [x] Pruebas en verde tras la implementación
- [x] Ataque adversarial sin fallas abiertas

## 005b · Foto y panel de solicitudes [005b, siguiente PR]

Se empieza con la 005a unida a `main`, en una rama nueva. No necesita migración (la de la 005a ya trae `foto_clave` y
los estados `CANCELADA`).

### Repaso de la especificación

- [x] T47 · especificador · **[005b]** Repaso del 21/11/2026 con la 005a unida a `main` (PR #8): precisiones técnicas
      PB1 a PB14 en la spec (definiciones de solicitud activa y estado visible; orden, códigos, cuerpos y límites de la
      foto; formato de lo guardado; `AlmacenArchivos`; transacción, bloqueos y fallos de la foto; registro técnico; regla
      del límite; lista, cancelación y ocupación exactas; web), contrato, impacto, riesgos y plan (secciones 8, 9, 11, 12
      y 14); preguntas nuevas B1 a B5, que no bloquean (criterios 28, 33 a 40, 43, 44, 46 y 48, partes de la 005b)
- [x] T0b · responsable · **[005b]** Responder B1 a B5. Respondidas el 21/11/2026, todas con la propuesta: DR-17 a
      DR-21 en la spec (criterio 39 sin correo al cancelar y prueba h; criterio 46 "Foto desde recepción"); B4 anotada
      en `specs/backlog.md` junto a la 007, B5 junto a la 008 y la política de retención de fotos (B2) como pendiente
      antes de producción

### Pruebas protegidas (en rojo)

- [x] T6a · test-writer · **[005b]** Pruebas protegidas de la foto, desde la spec y los contratos públicos, en archivos
      nuevos: el orden y los códigos del criterio 34 a a g (429, 400 por tipo y codificación, 413 con 5 242 881 bytes y
      con un `Content-Length` grande, 5 242 880 bytes que pasan, 404 y 403 de academia, 404 del token con el cuerpo del
      criterio 31, 409 por vencida, cancelada, fila `VENCIDA` del criterio 21 b y en el último milisegundo del mes, 400
      por firma, imagen cortada y dimensiones en los bordes), mismo cuerpo en todos los 400, `fotoCargada` en `true`
      después de subirla, nada cambia con un rechazo (criterio 34); recodificación con las comprobaciones del criterio 35
      (formato, metadatos, tamaños, orientación 6, texto marcado, poliglota); `AlmacenArchivosDisco` sobre un directorio
      temporal con las claves de rechazo, la academia ajena, el enlace simbólico (omitido con `EPERM`), `borrar`
      idempotente y ninguna ruta que sirva el directorio (criterio 36); carreras deterministas y fallos del almacén del
      criterio 37 a a f (con `overrideProvider(ALMACEN_ARCHIVOS)`); límite `foto` con su contador aparte, por /64 y con
      la IPv4 mapeada (parte de la 005b de 33); registro en memoria en `trace` con la foto, `X-Token-Solicitud` y
      `Referer`, y los rechazos (parte de la 005b de 28)
- [x] T6c · test-writer · **[005b]** Pruebas protegidas del panel, en archivos nuevos: lista con los permisos, el filtro
      (valores, defecto, 400 en `estado`), el orden, el tope de 200, las claves exactas de cada elemento, los datos
      actuales tras un 21 b, `?academiaId=` y el aislamiento (criterio 38); cancelación con el orden de comprobaciones,
      la decisión por estado (fila `PENDIENTE_PAGO` vigente y vencida, `CANCELADA` sin escribir, fila `VENCIDA` con 409),
      `reserva_vence_en` en `NULL`, la auditoría exacta y las pruebas a a h del criterio 39 (h: sin correo y con la foto
      intacta, DR-17 y DR-18); actualización de la prueba
      protegida de dependencias permitidas del backend solo para sumar `sharp` (criterio 127 de 001)
- [x] T7b · tester · **[005b]** Confirmar que T6a y T6c fallan por la razón esperada y que las protegidas de 001 a 005a
      siguen pasando. Commit del orquestador: "Pruebas protegidas (005b): foto y panel de solicitudes (en rojo)"

### Implementación

- [x] T15 · backend · **[005b]** `packages/contratos/src/fotos.ts` (PB4); `infraestructura/almacen-archivos` (interfaz,
      `ALMACEN_ARCHIVOS`, `AlmacenArchivosDisco`, módulo; `ALMACEN_DIRECTORIO` en el entorno y en `.env.example`);
      `sharp` en `backend/package.json` y en `scripts/lib/dependencias-backend.mjs`; lector binario de la foto
      (`cuerpo-imagen.ts`) y la ruta en `noLeerCuerpoEn` de `crear-app.ts`; regla `foto` en `LIMITES_PUBLICOS` (con
      `'PUT'` en `LimitePublico.metodo`); `x-token-solicitud` en `RUTAS_REDACTADAS` y la prueba no protegida de largo 5;
      estado visible común (PB2); `FotoService` y `PUT …/solicitudes/foto` con el orden de PB3 y la transacción de PB8
      (criterios 28 y 33 partes de la foto, 34 a 37; plan, secciones 8, 9 y 14)
- [x] T16b · backend · **[005b]** Contratos del panel (`solicitudPanelSchema`, `respuestaListaSolicitudesSchema`,
      `respuestaSolicitudPanelSchema`, `cancelarSolicitudSchema`, `filtroEstadoSolicitudesSchema`,
      `respuestaOcupacionSchema`); `GET /api/solicitudes` y `POST /api/solicitudes/{id}/cancelar` (criterios 38, 39) y
      `GET /api/clases/ocupacion` con `contarInscritos` y `contarOcupacion` (criterio 40, con prueba no protegida de
      permisos, aislamiento, clases inactivas y una matrícula del mes siguiente que cuenta en `inscritos` y no en
      `cuposRestantes`) (plan, sección 11)
- [x] T18b · frontend · **[005b]** Paso de la foto en el formulario (vista previa, avisos de tipo y tamaño con
      `fotos.ts`, subida después del 201 con el token en `X-Token-Solicitud`) y "subir foto" en el seguimiento, solo con
      la vista completa, con reintento y los mensajes de 400, 409, 413 y 429; pruebas de componentes con lo que fija PB14
      (partes de la 005b de 43 y 44)
- [x] T19 · frontend · **[005b]** Panel: "Solicitudes de inscripción" (lista, filtro, cancelar con motivo, 409 y 404),
      "Nueva inscripción" con `usuario.academia.nombreCorto`; ocupación "inscritos / aforo" en la grilla y diálogos de
      DR-5 en el formulario de clases; claves con la identidad de la sesión; pruebas de componentes con lo que fija PB14
      (criterio 46)
- [x] T19b · tester · **[005b]** Pruebas protegidas en verde y suite completa

### Ataque

- [x] T20b · adversarial · **[005b]** Atacar 34 a 39: imágenes maliciosas (bombas de descompresión, poliglotas, EXIF,
      tipos cambiados, `Content-Encoding`), rutas y claves de archivo, carreras con la foto y con la cancelación (envío y
      cancelación del mismo cliente, envío y foto del mismo DNI, foto y cancelación, cancelación y `PATCH` de aforo sobre
      la misma clase), token de otra academia, la foto en el último milisegundo del mes y desde el enlace de una
      solicitud anterior (21 b), `X-Token-Solicitud` en otras rutas y en los errores, lista y cancelación con ids de otra
      academia o con roles sin permiso, y el parámetro `estado` repetido o raro. Mismo ciclo por cada falla, hasta una
      ronda sin fallas.
      _(Ronda 1 hecha el 21/11/2026: dos fallas, criterios 61 y 62, y una observación, criterio 63; sección N de la
      spec. Siguió con las tareas de abajo, la ronda 2 (T55, tres fallas, sección O) y la ronda 3 (T64, sin fallas,
      sección P).)_

#### Ronda 1 del ataque (005b)

Fallas 1 (confirmación incierta de la foto) y 2 (Vite sirve el almacén), y la observación de las pruebas que escriben
en el almacén de desarrollo (criterios 61 a 63 y ajustes de 36 y 37, sección N de la spec). Las pruebas protegidas van
en archivos nuevos (por ejemplo `…-ronda1-005b.test.ts`), sin modificar las protegidas ya escritas de la 005a ni de la
005b.

- [x] T48 · especificador · **[005b]** Criterios 61 a 63 en `spec.md` (sección N), ajustes de 36 y 37, casos límite,
      impacto, regla "Archivos", riesgos aceptados (archivo huérfano tras una relectura fallida, confirmación incierta
      con una subida simultánea, nombres reservados de Windows, lo que sirve el servidor de desarrollo), AB1-1 a AB1-4;
      plan (secciones 9, 12 y 16, decisiones y riesgos) (criterios 36, 37, 61 a 63)
- [x] T49 · test-writer · **[005b]** Pruebas protegidas en rojo, desde la spec y los contratos públicos: utilidad del
      proxy de PostgreSQL (`backend/test/utilidades/proxy-postgres.ts`, modos `cortarTrasCommit`, `cortarAntesDelCommit`
      y `caer`, armado desde `AlmacenDeFallosDePrueba.alGuardar` y disparado por el `UPDATE` de `alumnos` con
      `foto_clave`) y los casos 1 a 5 del criterio 61 (204 con un solo archivo, 500 sin tocar `F1`, 500 sin borrar nada,
      reintento limpio, invariante, sin auditoría y el `warn` sin el token) (criterio 61); servidor de Vite real con el
      `frontend/vite.config.ts` en un puerto efímero: 403 y nunca los bytes de un JPEG creado en
      `backend/almacenamiento/academias/{uuid nuevo}/…` (y sus variantes de ruta), 403 en `backend/`, `docs/` y los
      archivos de la raíz, 200 en `/`, `/src/main.tsx`, `packages/contratos/package.json` y
      `node_modules/react/index.js`; `validarEntorno` con `ALMACEN_DIRECTORIO` dentro y fuera de las carpetas de la web
      (criterio 62)
- [x] T50 · tester · **[005b]** Confirmar que T49 falla por la razón esperada (archivo nuevo borrado con `foto_clave`
      apuntándolo, o 500 en el caso 1; 200 `image/jpeg` por `/@fs/` y 200 en `backend/`; `validarEntorno` que acepta el
      almacén dentro de `frontend/`) y no por sintaxis, importaciones o configuración; que el proxy funciona también en
      la integración continua de Windows; y que las demás protegidas siguen igual. `git diff --cached --stat` solo con
      archivos de prueba. Commit del orquestador: "Pruebas protegidas (005b, ronda 1): confirmación incierta de la foto
      y servidor de desarrollo (en rojo)"
- [x] T51 · backend · **[005b]** `FotoService.subir`: clave anterior fuera de `trabajo`, errores decididos por la
      transacción como hoy, y para los demás el `warn` `'Confirmación de la foto incierta'` y la relectura de
      `foto_clave` con las tres salidas b1 a b3 (criterios 37 y 61; plan, sección 9)
- [x] T52 · backend · **[005b]** `validarEntorno`: rechazo de `ALMACEN_DIRECTORIO` dentro de `frontend/`, `packages/` o
      `node_modules/` de la raíz, con sus casos en la prueba no protegida `entorno.test.ts` (criterio 62 b; plan,
      sección 9)
- [x] T53 · frontend · **[005b]** `frontend/vite.config.ts`: `server.fs.allow` con `frontend/`, `packages/contratos/` y
      `node_modules/` de la raíz, sin tocar `strict`, `deny` ni `preview`; comprobar `npm run dev` y las E2E (criterio
      62 a; plan, sección 12)
- [x] T54 · backend · **[005b]** `ALMACEN_DIRECTORIO` temporal en las pruebas del backend (`vitest.config.mts` o el
      `globalSetup` compartido, con borrado al terminar) y en la API de las E2E (`e2e/playwright.config.ts` y su
      `globalTeardown`); prueba no protegida de integración que comprueba que el almacén del proceso de pruebas queda
      fuera del repositorio; borrar a mano lo que haya quedado de pruebas en `backend/almacenamiento/` de la máquina de
      la sesión (no está versionado) (criterio 63; plan, sección 16)
- [x] T56 · tester · **[005b]** Pruebas protegidas de la 005b (también las de T49) en verde, suite completa, lint y
      verificación de tipos, también en Windows (antes de la ronda 2; después de ella lo repite T63)
- [x] T55 · adversarial · **[005b]** Ronda 2 sobre los criterios críticos de la 005b, con la spec y el código, incluidos
      61 y 62: cortes de la conexión en otros puntos de la transacción de la foto (antes del `UPDATE`, entre el
      `UPDATE` y el `COMMIT`, en la relectura), errores de la base que se hagan pasar por errores de negocio, subidas
      simultáneas con una confirmación incierta; rutas del servidor de desarrollo de la web hacia el almacén o
      `backend/` con codificaciones, `..`, barras invertidas, mayúsculas y unidades de Windows; y regresiones en 34 a
      39. (Un `ALMACEN_DIRECTORIO` que pasa por un enlace simbólico hacia `frontend/` es un riesgo aceptado, no una
      falla.) Mismo ciclo por cada falla, hasta
      una ronda sin fallas.
      _(Ronda 2 hecha el 21/11/2026: tres fallas, criterios 64 a 66; sección O de la spec. Sigue con las tareas de
      abajo y la ronda 3, T64, que terminó sin fallas.)_

#### Ronda 2 del ataque (005b)

Fallas 1 (la relectura no espera a un `COMMIT` tardío), 2 (Vite sirve el repositorio por los enlaces de los
workspaces) y 3 (formas de ruta de Windows en `ALMACEN_DIRECTORIO`): criterios 64 a 66 y ajustes de 37, 61 y 62
(sección O de la spec, AB2-1 a AB2-3). Las pruebas protegidas van en archivos nuevos (por ejemplo `…-ronda2-005b.test.ts`),
sin modificar las protegidas ya escritas de la 005a ni de la 005b; la única excepción es la utilidad protegida
`backend/test/utilidades/proxy-postgres.ts`, que suma el modo `retenerCommit` sin cambiar los del criterio 61.

- [x] T57 · especificador · **[005b]** Criterios 64 a 66 en `spec.md` (sección O), ajustes de 37, 61 b y c, 62 a y b,
      AB1-1 y AB1-3, casos límite, interfaz `resolverAlmacenDirectorio`, impacto, regla "Archivos", riesgos aceptados
      (lo que sirve el servidor de desarrollo, conexión medio abierta, archivo huérfano), AB2-1 a AB2-3; plan
      (secciones 9, 12, 16 y 17 nueva, decisiones y riesgos) (criterios 37, 61, 62, 64 a 66)
- [x] T58 · test-writer · **[005b]** Pruebas protegidas en rojo, desde la spec y los contratos públicos:
      - `proxy-postgres.ts`: modo `retenerCommit` (retiene el `COMMIT` hasta el `Sync`, cierra solo el lado de la API),
        `pidRetenido` desde el `BackendKeyData`, `liberar()`, `descartar()` y `cerrar()` con lo retenido, sin cambiar
        los modos del criterio 61; casos 1 a 5 del criterio 64 (204 tras `liberar()` con la espera vista en
        `pg_blocking_pids`, 500 tras `descartar()` con `F1` intacta, 500 sin borrar nada al agotarse la espera e
        invariante después de liberar o descartar, `F3` sin esperas, sin auditoría y el `warn` sin el token)
        (criterio 64);
      - servidor de Vite real: precondición de los enlaces de `backend`, `e2e` y `scripts`; 403 y nunca la imagen (ni
        en base64) por `node_modules/@aquagestion/backend/almacenamiento/…` con sus variantes de consulta, codificación,
        mayúsculas y rutas; 403 en `backend/`, `e2e/`, `scripts/`, `contratos/` y `frontend/` por el enlace; `deny` con
        los dos patrones y los valores por defecto; la web y la importación de los contratos siguen servidas
        (criterio 65);
      - `resolverAlmacenDirectorio` con `path.win32` y `path.posix` y las listas de valores del criterio 66, y
        `validarEntorno` en Windows con `\\?\`, `NODE_M~1\x`, `frontend.\public` y `os.tmpdir()` (criterio 66)
- [x] T59 · tester · **[005b]** Confirmar que T58 falla por la razón esperada: la subida del caso 1 responde antes de
      quedar bloqueada ("la relectura no esperó a la transacción original") o responde 500 y borra el archivo nuevo;
      200 `image/jpeg` por el enlace del workspace y `deny` sin los patrones; `resolverAlmacenDirectorio` que todavía no
      existe en `entorno.ts` y, en Windows, `validarEntorno` que acepta `\\?\…\frontend\public` y `NODE_M~1\x` (y no por
      sintaxis, importaciones de otras utilidades ni configuración). Que las protegidas del 61 y del 62 siguen pasando igual con la utilidad
      ampliada, y que el proxy funciona en la integración continua de Windows. `git diff --cached --stat` solo con
      archivos de prueba. Commit del orquestador: "Pruebas protegidas (005b, ronda 2): relectura con bloqueo, enlaces
      de los workspaces y rutas de Windows (en rojo)"
- [x] T60 · backend · **[005b]** `FotoService.resolverConfirmacionIncierta`: relectura en `conAcademia` con
      `lock_timeout` de `FOTO_ESPERA_RELECTURA_MS` (5000) y `SELECT … FOR SHARE`, sin `READ ONLY`; la espera
      agotada y cualquier error de la relectura van a b3 (criterios 61 y 64; plan, sección 9)
      _(Hecha: `lock_timeout` con la opción nueva `esperaMaximaDeBloqueoMs` de `BaseDatos.conAcademia` y no con `SET
      LOCAL` en el módulo, que prohíben las reglas de lint; precisado en la ronda 3, criterio 64 a y AB2-1.)_
- [x] T61 · frontend · **[005b]** `frontend/vite.config.ts`: `server.fs.deny` con los valores por defecto de Vite y
      `**/node_modules/@aquagestion` y `**/node_modules/@aquagestion/**`, sin tocar `allow`, `strict` ni `preview`;
      comprobar `npm run dev` (los contratos se piden por `packages/contratos`) y las E2E (criterio 65; plan, sección
      12)
- [x] T62 · backend · **[005b]** `resolverAlmacenDirectorio` pura en `entorno.ts` (formas de Windows, comparación por
      segmentos sin mayúsculas en todos los sistemas, nombres cortos como comodín con `path.win32`) y `validarEntorno`
      que la usa; ajuste de la prueba no protegida `entorno.test.ts` si fija la distinción de mayúsculas en Linux
      (criterio 66; plan, sección 9)
- [x] T63 · tester · **[005b]** Pruebas protegidas de la 005b (también las de T49 y T58) en verde, suite completa, lint
      y verificación de tipos, también en Windows (la del 62 b con el directorio temporal con nombre corto)
- [x] T64 · adversarial · **[005b]** Ronda 3 sobre los criterios críticos de la 005b, con la spec y el código, incluidos
      64 a 66: `COMMIT` retenido en otros puntos (antes del `UPDATE`, con el `UPDATE` en camino), relectura con la
      academia suspendida mientras espera, subidas y cancelaciones del mismo alumno mientras la fila está retenida;
      rutas de Vite hacia `node_modules/@aquagestion/` y hacia otros enlaces del repositorio con codificaciones, `..`,
      consultas y mayúsculas; más formas de ruta de Windows en `ALMACEN_DIRECTORIO`; y regresiones en 34 a 39, 61 y 62.
      (Un `ALMACEN_DIRECTORIO` que pasa por un enlace, una unión, `subst`, una unidad de red o un volumen montado hacia
      `frontend/`, otro enlace de `node_modules/` creado a mano y la conexión medio abierta son riesgos aceptados, no
      fallas.) Mismo ciclo por cada falla, hasta una ronda sin fallas.
      _Hecha el 21/11/2026 sobre el commit `2f695c2`: sin fallas reproducibles en 64 a 66 ni regresiones en 34 a 39, 61
      y 62 (sección P de la spec). Fin del ciclo adversarial de la 005b. Sus observaciones quedan como riesgos aceptados
      (caché de Vitest servida por Vite, enlaces que el sistema ya trae, mayúsculas de Unicode, `NUL\x` en Windows), y se
      precisa cómo se fija la espera de la relectura (opción `esperaMaximaDeBloqueoMs`, criterio 64 a y AB2-1)._
- [x] T65 · especificador · **[005b]** Registro de la ronda 3: sección P, estado, clasificación, criterio 64 a, AB2-1,
      "Interfaces del backend" (`OpcionesTransaccion.esperaMaximaDeBloqueoMs`), impacto en la 001 y riesgos aceptados
      en la spec; plan (módulos afectados, secciones 9 y 17, decisiones); T60 y estas tareas marcadas

### Revisión y cierre

- [x] T21b · orquestador · **[005b]** Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
      (de la 005a ni de la 005b) _(verificado con `verificar-pruebas-protegidas` y revisión a mano de cada commit)_
- [x] T22b · revisor · **[005b]** Comparar con la spec (criterios de la 005b) y las reglas; verificar la documentación de
      la 005b (parte de 48) _(hecha: la revisión no encontró bloqueos)_
- [x] T23b · tester · **[005b]** Suite completa, lint y verificación de tipos, también la integración continua en Windows
      por `sharp`
- [x] T24b · documentador · **[005b]** Commit, tareas marcadas, `docs/arquitectura.md` (la foto, `AlmacenArchivos` con
      su formato de clave, la lista, la cancelación y la ocupación; "Lo que todavía no trae" sin lo de la 005b; la regla
      "Archivos"), `README.md` y guía de uso (panel de solicitudes y foto), `.env.example` con `ALMACEN_DIRECTORIO`;
      comprobar que siguen en `specs/backlog.md` las notas de B4 (007), B5 (008) y la política de retención de fotos
      (B2), ya anotadas al responder T0b; 005b y la historia 005 como ✅ al unirla (parte de 48)
      _(hecha en este commit; el ✅ de la 005b y de la 005 al unirla lo pone el orquestador)_

### Solo ruta crítica (005b)

- [x] Pruebas escritas por test-writer y confirmadas en rojo _(T7b, T50 y T59)_
- [x] Pruebas en verde tras la implementación _(T19b, T56 y T63: suite completa en verde el 21/11/2026; Windows en la CI
      del PR)_
- [x] Ataque adversarial sin fallas abiertas _(ronda 3, T64)_
