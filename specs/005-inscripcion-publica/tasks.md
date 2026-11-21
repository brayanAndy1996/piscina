# 005 · Tareas

Cada tarea indica su rol y los criterios de aceptación de [`spec.md`](spec.md) que cubre. La historia se entrega en dos
PR desde esta carpeta (DR-11 de 005, "División en 005a y 005b" de la spec), las dos de ruta crítica y cada una con su
propio rojo, su ataque y su cierre:

- **005a · inscripción, reserva y seguimiento** (primero): criterios 1 a 33, 41 a 45 y 47 a 60. Críticos con pruebas
  protegidas: 1 a 10, 12 a 33, 41, 42 y 49 a 60 (49 a 53, de la ronda 1 del ataque; 54 a 60, de las respuestas del
  responsable a la ronda 1). Prueba obligatoria: 11, 43, 44 y 45. Revisor: 47 (con prueba no protegida desde la ronda
  1) y 48.
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
- [ ] T0b · responsable · **[005b]** Responder B1 a B5 (no bloquean: mientras tanto rige "Mientras tanto" de cada una)

### Pruebas protegidas (en rojo)

- [ ] T6a · test-writer · **[005b]** Pruebas protegidas de la foto, desde la spec y los contratos públicos, en archivos
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
- [ ] T6c · test-writer · **[005b]** Pruebas protegidas del panel, en archivos nuevos: lista con los permisos, el filtro
      (valores, defecto, 400 en `estado`), el orden, el tope de 200, las claves exactas de cada elemento, los datos
      actuales tras un 21 b, `?academiaId=` y el aislamiento (criterio 38); cancelación con el orden de comprobaciones,
      la decisión por estado (fila `PENDIENTE_PAGO` vigente y vencida, `CANCELADA` sin escribir, fila `VENCIDA` con 409),
      `reserva_vence_en` en `NULL`, la auditoría exacta y las pruebas a a g del criterio 39; actualización de la prueba
      protegida de dependencias permitidas del backend solo para sumar `sharp` (criterio 127 de 001)
- [ ] T7b · tester · **[005b]** Confirmar que T6a y T6c fallan por la razón esperada y que las protegidas de 001 a 005a
      siguen pasando. Commit del orquestador: "Pruebas protegidas (005b): foto y panel de solicitudes (en rojo)"

### Implementación

- [ ] T15 · backend · **[005b]** `packages/contratos/src/fotos.ts` (PB4); `infraestructura/almacen-archivos` (interfaz,
      `ALMACEN_ARCHIVOS`, `AlmacenArchivosDisco`, módulo; `ALMACEN_DIRECTORIO` en el entorno y en `.env.example`);
      `sharp` en `backend/package.json` y en `scripts/lib/dependencias-backend.mjs`; lector binario de la foto
      (`cuerpo-imagen.ts`) y la ruta en `noLeerCuerpoEn` de `crear-app.ts`; regla `foto` en `LIMITES_PUBLICOS` (con
      `'PUT'` en `LimitePublico.metodo`); `x-token-solicitud` en `RUTAS_REDACTADAS` y la prueba no protegida de largo 5;
      estado visible común (PB2); `FotoService` y `PUT …/solicitudes/foto` con el orden de PB3 y la transacción de PB8
      (criterios 28 y 33 partes de la foto, 34 a 37; plan, secciones 8, 9 y 14)
- [ ] T16b · backend · **[005b]** Contratos del panel (`solicitudPanelSchema`, `respuestaListaSolicitudesSchema`,
      `respuestaSolicitudPanelSchema`, `cancelarSolicitudSchema`, `filtroEstadoSolicitudesSchema`,
      `respuestaOcupacionSchema`); `GET /api/solicitudes` y `POST /api/solicitudes/{id}/cancelar` (criterios 38, 39) y
      `GET /api/clases/ocupacion` con `contarInscritos` y `contarOcupacion` (criterio 40, con prueba no protegida de
      permisos, aislamiento, clases inactivas y una matrícula del mes siguiente que cuenta en `inscritos` y no en
      `cuposRestantes`) (plan, sección 11)
- [ ] T18b · frontend · **[005b]** Paso de la foto en el formulario (vista previa, avisos de tipo y tamaño con
      `fotos.ts`, subida después del 201 con el token en `X-Token-Solicitud`) y "subir foto" en el seguimiento, solo con
      la vista completa, con reintento y los mensajes de 400, 409, 413 y 429; pruebas de componentes con lo que fija PB14
      (partes de la 005b de 43 y 44)
- [ ] T19 · frontend · **[005b]** Panel: "Solicitudes de inscripción" (lista, filtro, cancelar con motivo, 409 y 404),
      "Nueva inscripción" con `usuario.academia.nombreCorto`; ocupación "inscritos / aforo" en la grilla y diálogos de
      DR-5 en el formulario de clases; claves con la identidad de la sesión; pruebas de componentes con lo que fija PB14
      (criterio 46)
- [ ] T19b · tester · **[005b]** Pruebas protegidas en verde y suite completa

### Ataque

- [ ] T20b · adversarial · **[005b]** Atacar 34 a 39: imágenes maliciosas (bombas de descompresión, poliglotas, EXIF,
      tipos cambiados, `Content-Encoding`), rutas y claves de archivo, carreras con la foto y con la cancelación (envío y
      cancelación del mismo cliente, envío y foto del mismo DNI, foto y cancelación, cancelación y `PATCH` de aforo sobre
      la misma clase), token de otra academia, la foto en el último milisegundo del mes y desde el enlace de una
      solicitud anterior (21 b), `X-Token-Solicitud` en otras rutas y en los errores, lista y cancelación con ids de otra
      academia o con roles sin permiso, y el parámetro `estado` repetido o raro. Mismo ciclo por cada falla, hasta una
      ronda sin fallas.

### Revisión y cierre

- [ ] T21b · orquestador · **[005b]** Revisar con `git diff` que ningún commit de implementación tocó pruebas protegidas
      (de la 005a ni de la 005b)
- [ ] T22b · revisor · **[005b]** Comparar con la spec (criterios de la 005b) y las reglas; verificar la documentación de
      la 005b (parte de 48)
- [ ] T23b · tester · **[005b]** Suite completa, lint y verificación de tipos, también la integración continua en Windows
      por `sharp`
- [ ] T24b · documentador · **[005b]** Commit, tareas marcadas, `docs/arquitectura.md` (la foto, `AlmacenArchivos` con
      su formato de clave, la lista, la cancelación y la ocupación; "Lo que todavía no trae" sin lo de la 005b; la regla
      "Archivos"), `README.md` y guía de uso (panel de solicitudes y foto), `.env.example` con `ALMACEN_DIRECTORIO`; las
      preguntas B1 a B5 que sigan abiertas, en `specs/backlog.md` junto a la historia que las decide (B4 en la 007, B5 en
      la 008); 005b y la historia 005 como ✅ al unirla (parte de 48)

### Solo ruta crítica (005b)

- [ ] Pruebas escritas por test-writer y confirmadas en rojo
- [ ] Pruebas en verde tras la implementación
- [ ] Ataque adversarial sin fallas abiertas
