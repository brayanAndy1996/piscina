# 005 · Inscripción pública y seguimiento de la solicitud

- **Historias y requerimientos:** HU-01 (formulario: datos personales, ficha médica, apoderado si es menor, DNI de 8
  dígitos no registrado, aceptación del tratamiento de datos y del deslinde), HU-02 (días y horario según el nivel, solo
  clases con cupo, tantos días como la frecuencia del plan, cupos restantes, aviso si la clase se llena mientras se
  elige), HU-34 y RN-25 (cobro proporcional: clases restantes según los días elegidos, con tope en las del plan, redondeo
  hacia arriba al sol entero), RN-01 (es cliente hasta que su primer pago se confirma), RN-03 con D-28 (DNI único por
  academia), RN-08 (elige días y horario al inscribirse), RN-09 a RN-11 (bloques, niveles, aforo de 20 a 50 y nunca por
  encima), RN-20 (apoderado obligatorio para menores), RN-21 (datos médicos de acceso restringido), RN-27 (sin
  matrícula: solo la mensualidad), RN-28 (el cupo queda reservado mientras el pago está pendiente), RNF-05 (Ley 29733:
  datos de salud y de menores, consentimiento expreso), RNF-06 (auditoría), RNF-09 (límites por archivo), RNF-12
  (America/Lima, soles); sección 2.1 (Cliente: autoinscripción), 4.1 (proceso de inscripción), 8.7 (pantallas
  públicas), 8.8 (estados de persona y de matrícula), 9.1 (`ALUMNO`, `APODERADO`, `FICHA_MEDICA`, `MATRICULA`,
  `MATRICULA_CLASE`) y 11.4 (riesgos: cupos bloqueados, datos médicos y de menores); D-03 (orden del cálculo del cobro),
  D-05 (código y enlace de seguimiento), D-06 (prioridad al renovar: no se adelanta), D-07 (consentimientos y solicitud),
  D-15 (el nivel decide las clases), D-19 y D-21 (`EnviadorCorreo` y `AlmacenArchivos`), D-20 y D-24 (foto opcional),
  D-22 (teléfono de la configuración), D-23 (todo por academia), D-27 (nombre corto en la dirección), D-29 (el
  Superadmin no ve datos internos). De las specs anteriores: DR-4 de 003 (teléfono en las páginas públicas desde esta
  historia), DT-1, DR-2, DR-5 y DR-6 de 004 (ocupación, vigencia del plan, aforo con inscritos, entrenador inactivo),
  nota O2 de 001 (límite de peticiones en `GET /api/a/{nombreCorto}`) y regla DT-5 de 002.
- **Ruta crítica:** sí. Toca cinco puntos de la lista de `CLAUDE.md`: entradas públicas (formulario, foto y enlace de
  seguimiento), aforo y reservas (último cupo simultáneo y reserva mientras el pago está pendiente), cálculo del cobro
  (proporcional y redondeo), datos sensibles de menores y de salud (Ley 29733) y aislamiento entre academias (rutas
  públicas, token de seguimiento y archivos). La web, la semilla y la documentación no son críticas.
- **Estado:** aprobada por el responsable (20/11/2026), con las propuestas de todas las preguntas de negocio (DR-1 a
  DR-11 de esta spec) y las técnicas aprobadas por el orquestador (DT-1 a DT-9), en "Decisiones". Ningún criterio
  cambió de intención. Con precisiones técnicas para las pruebas protegidas de la 005a (P1 a P10, en "Decisiones"), sin
  cambios de negocio. **Ronda 1 del ataque de la 005a (20/11/2026):** criterios nuevos 49 a 53 (sección K), ajustes de
  los criterios 12, 19, 27, 28 y 47, y preguntas de negocio para el responsable (R1 a R5). **Respuestas del responsable
  a la ronda 1 (20/11/2026):** decisiones DR-12 a DR-16 y criterios nuevos 54 a 60 (sección L), con ajustes de los
  criterios 16, 25, 27, 32, 33, 44 y 47; R5 pasa a la 007 (DR-16). Queda una pregunta nueva que no bloquea (R6, en
  "Preguntas abiertas").
- **División (DR-11):** la historia se entrega en dos PR desde esta misma carpeta, las dos de ruta crítica, cada una con
  sus pruebas protegidas, su ataque y su cierre (ver "División en 005a y 005b"):
  - **005a · Inscripción, reserva y seguimiento** (se construye primero): criterios 1 a 33, 41 a 45, 47 a 60, salvo las
    partes de 28, 33, 43, 44 y 48 que tratan de la foto o del panel de solicitudes.
  - **005b · Foto y panel de solicitudes** (siguiente PR): criterios 34 a 40 y 46, más esas partes.

## Objetivo

Que una persona interesada (o su padre, madre o apoderado) se inscriba desde el celular en el enlace público de su
academia (`/a/{academia}/inscripcion`), con sus datos, su ficha médica y su foto opcional; elija plan, días y horario
entre las clases de su nivel que tienen cupo; vea el monto que pagará (proporcional si entra a mitad de mes); y reciba un
código y un enlace secreto para seguir su solicitud. Su lugar queda reservado mientras paga, y nunca se inscriben más
personas que el aforo de una clase, aunque dos tomen el último cupo a la vez. El pago, su verificación y el paso de
cliente a alumno son de la 007; la caja, de la 006.

## Clasificación de ruta crítica

Llevan pruebas protegidas (escritas antes del código) y ataque adversarial los criterios marcados _(crítico)_:

- **Aislamiento en la base y en las rutas públicas (1 a 7, 31, 36, 38):** las tablas nuevas guardan datos personales,
  médicos y de menores de cada academia (D-23). La academia sale solo del nombre corto de la dirección en las rutas
  públicas y de la sesión en las del panel; un id, un token, un código o un archivo de otra academia se comporta como
  inexistente.
- **Cálculo del cobro (8 a 10, 19):** el monto proporcional, el tope en las clases del plan y el redondeo hacia arriba
  una sola vez, en America/Lima y sin coma flotante (RN-25, HU-34, D-03). El monto que ve el cliente es el que se guarda.
- **Entradas públicas (12 a 15, 21 a 25, 33 a 35, 37):** el formulario, la foto (JPG o PNG de hasta 5 MB) y el enlace de
  seguimiento son la puerta anónima del sistema: validación estricta, límites por IP, enlace que no se puede adivinar ni
  recorrer, envíos repetidos que no duplican nada.
- **Aforo y reservas (16 a 18, 20, 39, 41, 42):** RN-11, RN-28 y la regla "nunca más inscritos que el aforo, aunque dos
  personas tomen el último cupo a la vez"; reservas que vencen y se liberan; DR-5 de 004 (bajar el aforo por debajo de
  los inscritos con confirmación, no desactivar una clase con inscritos).
- **Datos sensibles y auditoría (13, 14, 26 a 32):** apoderado de menores (RN-20), evidencia de los consentimientos
  (D-07, Ley 29733), vista mínima del enlace de seguimiento, auditoría y registro técnico sin DNI, salud ni token, y el
  correo con el enlace solo después de confirmar.
- **Permisos del panel (38, 39, 41 y 42):** solo el administrador y la secretaria ven y cancelan solicitudes; solo el
  administrador cambia el aforo y desactiva clases.
- **Ronda 1 del ataque de la 005a (49 a 53):** límites por IP que no se saltan con `HEAD` (entradas públicas), el monto
  cotizado que siempre se puede enviar (cálculo del cobro), la respuesta que no espera al correo (entradas públicas y
  efectos después de confirmar) y el registro técnico sin destinatarios ni tokens (datos sensibles).
- **Respuestas del responsable a la ronda 1 (54 a 60):** la reserva que nunca cruza el mes, en el dominio, la API y la
  base (aforo y reservas, y cálculo de la fecha en America/Lima); el correo al apoderado (entradas públicas y efectos
  después de confirmar, con datos de menores); la vista sin nombre de una solicitud que ya no es la vigente (datos
  sensibles); y los límites por conexión con IPv6 por bloque /64 (entradas públicas: sin ellos, el límite de 5 reservas
  y los límites por minuto se saltan cambiando de dirección).

No son críticos, pero llevan _(prueba obligatoria)_: 11 (cotización, salvo lo que cubren 8 a 10) y 40 (API), y 43 a
46 (web, con pruebas de componentes). Los 47 y 48 (semilla y documentación) los verifica el revisor. _(Aprobado por el
orquestador, DT-3.)_

## División en 005a y 005b

Decidida por el responsable (DR-11). Las dos entregas comparten esta spec, `plan.md` y `tasks.md`; las tareas y los
criterios de la 005b llevan la marca **[005b, siguiente PR]**. El test-writer de la 005a escribe solo las pruebas
protegidas de los criterios críticos de la 005a; las de la 005b se escriben, se confirman en rojo y se atacan en el PR
de la 005b, en archivos de prueba nuevos (sin modificar los protegidos de la 005a).

| Entrega | Criterios críticos (pruebas protegidas y ataque) | Prueba obligatoria | Revisor |
| --- | --- | --- | --- |
| **005a** · inscripción, reserva y seguimiento | 1 a 10, 12 a 33, 41, 42 y 49 a 60 | 11, 43, 44 y 45 (y la prueba no protegida de la semilla, 47) | 47 y 48 |
| **005b** · foto y panel de solicitudes | 34 a 39, más la foto en 28 y 33 | 40 y 46 (y la foto en 43 y 44) | parte de 48 |

**Partes de criterios de la 005a que se completan en la 005b:**

- **28:** en la 005a, la prueba del registro técnico cotiza, envía y consulta; la subida de la foto se prueba en la 005b,
  en una prueba protegida aparte con el mismo registro en memoria.
- **33:** en la 005a, los límites de las dos lecturas, la cotización, el envío y la consulta; el de la foto (10 por hora)
  llega con su ruta en la 005b, con su propia prueba protegida.
- **43:** en la 005a, el formulario no tiene el paso de la foto; el paso, su vista previa, sus avisos y el reintento
  desde el seguimiento son de la 005b.
- **44:** en la 005a, la página de seguimiento no ofrece "subir foto"; llega en la 005b.
- **48:** en la 005a se documenta todo menos `AlmacenArchivos`, la regla "Archivos" de "Reglas para las historias
  siguientes", `ALMACEN_DIRECTORIO` en `.env.example` y el panel de solicitudes en el `README.md` y la guía de uso, que
  documenta la 005b.
- **53 (ronda 1):** en la 005a se redacta la cabecera `Referer`; la cabecera `X-Token-Solicitud` de la foto (criterio
  34) se redacta igual en la 005b, con su ruta y su prueba protegida (el criterio 28 ya exige que el token no llegue al
  registro técnico).
- **59 (respuesta R4):** en la 005a, las reglas de las dos lecturas, la cotización, el envío y la consulta cuentan por
  clave de conexión; la regla de la foto (10 por hora) usa la misma clave y se prueba en la 005b, con su ruta.
- **58 (respuesta R3):** en la 005a, una solicitud `VENCIDA` o `CANCELADA` no tiene subida de foto; en la 005b, la
  subida (criterio 34) solo acepta solicitudes con la vista completa, así que `fotoCargada` sigue existiendo donde se
  puede subir.

**Dependencias entre las dos entregas y cómo quedan resueltas:**

- **La migración de la 005a crea las siete tablas completas** (criterios 1 a 4), también `alumnos.foto_clave` y su
  privilegio de `UPDATE`, y el estado `CANCELADA` de solicitudes y matrículas. La 005b no necesita migración para la
  foto ni para cancelar. Así las pruebas de catálogo y de privilegios de la 005a no cambian en la 005b.
- **`fotoCargada` en la vista mínima (criterio 32)** existe desde la 005a para que el esquema estricto no cambie en la
  005b: se calcula como `alumnos.foto_clave IS NOT NULL` y en la 005a siempre es `false`, porque no hay forma de subir
  una foto.
- **Solicitudes canceladas en la 005a (criterios 20, 21 b, 25 y 42):** la API para cancelar (criterio 39) es de la 005b.
  Las pruebas de la 005a crean las solicitudes y matrículas `CANCELADA` escribiendo las filas como dueño de las tablas
  (utilidad de pruebas), y la secretaria todavía no puede cancelar desde el panel. Las reservas falsas se liberan solas
  al vencer (criterio 20) mientras tanto.
- **DR-5 de 004 (criterios 41 y 42) va en la 005a,** porque el último cupo simultáneo frente a un cambio de aforo
  (criterio 18 e) y los inscritos que ignoran reservas vencidas (criterio 20) los usan. `contarInscritos` es de la 005a.
  En la web, el diálogo de confirmación del aforo menor, el mensaje de `CLASE_CON_INSCRITOS` y "inscritos / aforo" en
  la grilla son del criterio 46 (005b): mientras tanto, `/panel/clases` muestra esos 409 como cualquier error de la
  004, y el administrador no puede bajar el aforo por debajo de los inscritos desde la web (el lado seguro).
- **La ocupación para el administrador (`GET /api/clases/ocupacion`, criterio 40)** es de la 005b, junto con la grilla
  que la usa (criterio 46).
- **"Nueva inscripción" en el panel (DR-10, criterio 46)** es de la 005b; en la 005a la secretaria abre en recepción la
  dirección pública `/a/{nombreCorto}/inscripcion`, que es el mismo formulario.
- **`sharp`, el lector binario y `AlmacenArchivos`** (impacto en los criterios 74 y 127 de 001) entran con la 005b; la
  005a no toca el lector de cuerpos ni las dependencias permitidas del backend.
- Ningún criterio de la 005b cambia un contrato de la 005a: la 005b suma rutas, códigos de error
  (`SOLICITUD_NO_EDITABLE`, `SOLICITUD_NO_CANCELABLE`, `IMAGEN_NO_VALIDA`) y la auditoría
  `SOLICITUD_INSCRIPCION_CANCELADA`.

## Criterios de aceptación

Definiciones usadas en los criterios. A y B son dos academias activas; "ruta pública" es una ruta bajo
`/api/a/{nombreCorto}/…` sin sesión; "ruta de academia", "sesión válida" y "actor vigente" son los de la spec 002.

- **Ahora:** el instante de `RELOJ.ahora()`, tomado una vez al empezar a atender la petición. **Hoy** y **mes en curso:**
  la fecha y el mes de "ahora" en America/Lima (`hoyEnLima`), nunca en la zona del servidor ni con `CURRENT_DATE`.
- **Matrícula que ocupa cupo en el mes M:** una matrícula de M en estado `VIGENTE`, o en estado `RESERVADA` con
  `reserva_vence_en` nula (pago en verificación, desde la 007) o posterior a "ahora".
- **Ocupación de la clase C en el mes M:** cuántas matrículas que ocupan cupo en M incluyen a C. **Cupos restantes:**
  `max(0, aforo − ocupación del mes en curso)`. **Inscritos de C:** la mayor ocupación de C entre el mes en curso y los
  meses siguientes (para DR-5 de 004).
- **Solicitud activa:** una solicitud en estado `PENDIENTE_PAGO` cuya matrícula todavía ocupa cupo. **Solicitud
  vencida:** una `PENDIENTE_PAGO` cuya reserva venció; se muestra como `VENCIDA` aunque la fila aún no lo diga.
- **Reserva sin pago:** 24 horas desde el envío (DR-1), pero nunca después del fin del mes de la matrícula en
  America/Lima: vence en lo que ocurra primero, "ahora" más 24 horas o las 23:59:59.999 del último día del mes en curso
  (DR-12, criterio 54).
- **Fin del mes en Lima:** las 23:59:59.999 del último día del mes en America/Lima (para noviembre de 2026,
  `2026-12-01T04:59:59.999Z`), calculado con `@date-fns/tz`, sin depender de la zona del servidor.
- **Clave de conexión:** la forma en que se agrupan las IP en los límites por conexión (criterios 25, 33 y 49): una IPv4,
  también escrita como IPv6 mapeada (`::ffff:a.b.c.d`), cuenta por su dirección exacta; cualquier otra IPv6, por su
  bloque /64 (DR-15, criterio 59).
- **Vista mínima:** lo que muestra el enlace de seguimiento (criterio 32).

### A. Tablas, aislamiento y privilegios en la base

1. **Tablas nuevas.** Dadas las migraciones aplicadas, entonces existen `alumnos`, `apoderados`, `fichas_medicas`,
   `consentimientos`, `solicitudes_inscripcion`, `matriculas` y `matricula_clases`, con las columnas de "Cambios al
   modelo de datos", con `academia_id`, RLS activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE` con la forma
   exacta del criterio 132 de 001 (y de `DELETE` solo en `apoderados`, pregunta N6), y `UNIQUE (academia_id, id)` en las
   que reciben llaves y en `consentimientos` (P5). Toda referencia entre ellas y hacia `planes`, `clases` y `usuarios` es una llave foránea
   compuesta `(academia_id, …) → (academia_id, id)`. Las llaves primarias que no son solo `id` llevan `academia_id` como
   primera columna (P10): `(academia_id, alumno_id)` en `apoderados` y en `fichas_medicas`, y `(academia_id,
   matricula_id, clase_id)` en `matricula_clases`. Todas las pruebas de catálogo de 001 (criterios 9 a 13, 17, 18, 124
   a 126, 131 a 133 y 142) siguen pasando y `TABLAS_DESPUES_DE_MIGRAR` suma las siete. _(crítico)_ (D-17, D-23; criterio 12
   de 001)
2. **Privilegios mínimos.** Dado el rol `aquagestion_app`, entonces sus privilegios son exactamente los de "Cambios al
   modelo de datos" (`SELECT` e `INSERT` en las siete; `UPDATE` solo de las columnas listadas; `DELETE` solo en
   `apoderados`); no puede cambiar el DNI de un alumno, el código ni el token de una solicitud, ni la `academia_id` de
   ninguna fila, ni el `creado_en` de `apoderados` ni de `fichas_medicas` (P4), ni borrar consentimientos, solicitudes ni
   matrículas. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se
   amplían igual y la API sigue atendiendo (criterio 102 de 001). _(crítico)_ (D-23, Ley 29733)
3. **RLS y llaves compuestas.** Dadas filas de las siete tablas en A y en B, como app: en contexto de A, `SELECT` devuelve
   solo las de A; un `INSERT` con `academia_id` de B y un `UPDATE` que mueve una fila de A a B fallan con `42501`; en
   contexto de plataforma o sin contexto devuelven 0 filas y el `INSERT` falla (el Superadmin no ve nada, D-29). Una
   matrícula de A con un `plan_id` o un `clase_id` de B, o una solicitud de A con un `alumno_id` de B, fallan con
   `23503`, aunque quien inserte sea el dueño de las tablas. _(crítico)_ (D-23, D-29)
4. **Invariantes en la base.** Dado un `INSERT` o `UPDATE` directo (como app y como dueño de las tablas), entonces falla
   con `23514` o `23505`, según el caso:
   - a) `alumnos.dni` que no sean 8 dígitos; dos alumnos de A con el mismo DNI (`23505`; en B se acepta, D-28);
   - b) `fecha_nacimiento` no finita;
   - c) `matriculas`: `mes` fuera de 1 a 12; `clases_totales` menor que 1 o mayor que `clases_por_mes_plan`;
     `clases_usadas` negativas o mayores que `clases_totales`; `precio_plan` o `monto_calculado` menores o iguales que 0
     o `NaN`; `clases_por_mes_plan` menor que 1; `fecha_fin` anterior a `fecha_inicio` o fuera del mes de `anio` y
     `mes`; `reserva_vence_en` no nula en una matrícula que no está `RESERVADA` (`estado = 'RESERVADA' OR
     reserva_vence_en IS NULL`);
   - d) dos matrículas que ocupan cupo del mismo alumno en el mismo mes (`23505`, índice parcial sobre `RESERVADA` y
     `VIGENTE`);
   - e) dos solicitudes `PENDIENTE_PAGO` del mismo alumno (`23505`, índice parcial); dos solicitudes de A con el mismo
     código o el mismo hash de token (`23505`);
   - f) `solicitudes_inscripcion.codigo` que no cumpla el formato del criterio 24 y `token_hash` que no tenga 32 bytes;
   - g) `consentimientos` con un tipo fuera de `DATOS_PERSONALES`, `DESLINDE` e `IMAGEN` (`22P02`, porque la columna es
     el enum `tipo_consentimiento`, o `23514`; P6), o una versión vacía (`23514`).

   _(crítico)_ (RN-11, RN-25, D-07, D-28)

### B. Datos públicos de la academia y oferta

5. **Teléfono público.** Dada una academia activa, `GET /api/a/{nombreCorto}` responde 200 con
   `{ nombreCorto, nombre, telefono }`, donde `telefono` es el valor efectivo de la configuración (`leerConfiguracion`
   con la `tx` de la ruta, sin caché) o `null`. Sigue sin id, estado ni motivo, con `Cache-Control: no-store`, y con los
   mismos 404 y 403 de los criterios 58 a 60 de 001. Un cambio de teléfono confirmado se ve en la petición siguiente.
   _(crítico)_ (DR-4 de 003, D-22; amplía el criterio 58 de 001)
6. **Datos del formulario.** Dada una academia activa, `GET /api/a/{nombreCorto}/inscripcion` responde 200 con
   `RespuestaFormularioInscripcion`:
   - `academia`: `nombre` y `telefono`;
   - `mes` (`AAAA-MM`) y `hoy` (`AAAA-MM-DD`), del mes en curso;
   - `planes`: solo los activos y en estado `VIGENTE` hoy (criterio 14 de 004, DR-2 de 004), con `id`, `nombre`,
     `vecesPorSemana`, `clasesPorMes`, `duracionMinutos`, `precio` (texto con dos decimales), `diasPermitidos`,
     `franjasPermitidas` y `nivelesAplicables`; nunca los inactivos, programados ni vencidos;
   - `clases`: solo las activas con cupos restantes mayores que 0, con `id`, `nivel`, `diaSemana`, `horaInicio`,
     `horaFin` y `cuposRestantes`; sin entrenador, sin aforo y sin ocupación;
   - `consentimientos`: la `version` vigente y el texto de cada tipo, con el nombre de la academia (criterio 14).

   Todo de la academia del nombre corto, con `Cache-Control: no-store`. Una clase llena, una inactiva o una de otra
   academia no aparece. _(crítico)_ (HU-02, RN-11, DR-2 de 004)
7. **Ids de otra academia en las rutas públicas.** Dadas las rutas públicas de A, cuando el cuerpo trae un `planId`, un
   `claseId` o un token de B, entonces la respuesta es idéntica a la de un id o token que no existe (criterios 15 y 31),
   sin leer ni escribir nada de B. Un `academiaId` en el cuerpo, en la consulta o en una cabecera no cambia de academia:
   el cuerpo con campos de más responde 400 y los parámetros de consulta se ignoran. _(crítico)_ (D-23, D-27)

### C. Cálculo del cobro (funciones puras del dominio)

8. **Clases restantes del mes.** Dadas las clases elegidas (día de la semana y hora de inicio de cada una) y "ahora",
   `clasesRestantes` cuenta, para cada fecha desde hoy hasta el último día del mes en curso (en America/Lima), las clases
   elegidas cuyo día de la semana coincide; las de hoy cuentan solo si su hora de inicio en Lima es posterior a "ahora"
   (provisional, pregunta N2). `clasesTotales = min(clasesRestantes, clasesPorMes)` (tope de HU-34) y
   `esProporcional = clasesRestantes < clasesPorMes`. Pruebas unitarias en los bordes: la clase de 19:00 a las 18:59:59 y
   a las 19:00:00 de Lima (`2026-11-20T23:59:59Z` y `2026-11-21T00:00:00Z`); el último día del mes después de la última
   clase (0 restantes); febrero de 2027 y un mes con cinco lunes; el cambio de año; y con el proceso en otra zona horaria
   (`TZ=Asia/Tokyo`). _(crítico)_ (HU-34, RN-25, RNF-12)
9. **Monto exacto.** `montoProporcional(precio, clasesPorMes, clasesTotales)` es
   `precio × clasesTotales ÷ clasesPorMes` calculado de forma exacta (aritmética racional o en céntimos con enteros, nunca
   `number`) y redondeado hacia arriba al sol entero una sola vez, al final. Ejemplos de D-03: S/ 100 de 12 clases con
   12 → S/ 100; con 5 → S/ 42; S/ 210 de 12 con 5 → S/ 88. Además: S/ 200 de 3 clases con 3 → S/ 200 (no 201, el error
   de dividir primero y redondear el cociente); S/ 100 de 3 con 1 → S/ 34; S/ 120.50 de 12 con 12 → S/ 121 (el total
   siempre se redondea al sol, D-03). Prueba de propiedades: el resultado es un entero, nunca menor que el valor exacto
   ni mayor que ese valor más 1, y con `clasesTotales = clasesPorMes` es el precio redondeado hacia arriba. _(crítico)_
   (RN-25, HU-34, D-03)
10. **Orden completo de D-03.** `calcularTotal({ base, montoAjustado?, descuento? })` aplica los pasos de D-03: el monto
    ajustado reemplaza al calculado; el descuento (porcentaje de 0 a 100, o monto fijo) se aplica sobre ese monto sin
    redondear; el monto nunca queda por debajo de 0; y el total se redondea hacia arriba al sol entero una sola vez.
    Prueba con la tabla de D-03 (S/ 100 de 12 clases con 5 y 10 % de descuento → S/ 38) y con un descuento fijo mayor que
    el monto (→ S/ 0). En esta historia nadie la llama con ajuste ni descuento: la usan la 007 (ajuste, HU-34) y la 015
    (descuento, HU-10). Tipos (P1): `base` es un `Racional = { numerador: bigint; denominador: bigint }` en soles;
    `descuento` es un `Descuento = { tipo: 'PORCENTAJE' | 'MONTO_FIJO'; valor: Decimal }` (en `PORCENTAJE`, `valor` de 0 a
    100; en `MONTO_FIJO`, soles); `montoAjustado` es un `Decimal` en soles. _(crítico)_ (D-03, HU-34)
11. **Cotización.** `POST /api/a/{nombreCorto}/inscripcion/cotizacion` con `{ planId, nivel, claseIds }` aplica las
    mismas validaciones de plan y clases que el envío (criterio 15) y responde 200 con
    `{ cotizacion: { mes, fechaInicio, fechaFin, clasesRestantes, clasesTotales, clasesPorMes, precioPlan, monto,
    esProporcional } }` (montos como texto con dos decimales). No escribe ni reserva nada, y no exige cupo (el cupo se
    comprueba al enviar). Con 0 clases restantes responde 409 `SIN_CLASES_EN_EL_MES`. _(prueba obligatoria; lo crítico
    del cálculo está en 8 a 10)_ (HU-34)

### D. Envío del formulario

12. **Validación del formulario.** `POST /api/a/{nombreCorto}/inscripcion` con `enviarInscripcionSchema` (estricto en
    todos sus niveles). Un cuerpo inválido responde 400 `SOLICITUD_INVALIDA` con `detalles.errores[].campo` en la ruta
    del campo (`alumno.dni`, `fichaMedica.contactoEmergencia.telefono`…), sin escribir, auditar ni enviar correo. Entre
    otros: DNI que no sea de 8 dígitos (`dniSchema`); fecha de nacimiento que no sea una fecha real, futura o de hace más
    de 100 años; teléfono que no sea un celular peruano de 9 dígitos que empieza con 9 (provisional, N5); correo con
    formato inválido o de más de 254 caracteres; nombres y apellidos fuera de 2 a 60 caracteres o sin letras visibles
    (`textoVisibleSchema`); textos médicos de más de 500 caracteres; nivel, tipo de sangre, grado o parentesco fuera de
    su lista; `claseIds` vacío, con repetidos o con más de 7; `planId` o `claseIds` que no son UUID;
    `claveIdempotencia` que no es un UUID; `mes` que no es `AAAA-MM`; `montoMostrado` que no cumple
    `montoCotizadoSchema` (criterio 50; antes decía `montoSchema`, que no admite el monto de 100000.00 que la cotización
    puede dar); controles o caracteres bidireccionales en cualquier texto. Campos obligatorios y opcionales: pregunta N5.
    _(crítico)_ (HU-01) _(ajustado por el criterio 50, ataque ronda 1)_
13. **Menor de edad y apoderado.** La persona es menor si hoy (Lima) todavía no cumplió 18 años según su fecha de
    nacimiento; el día de su cumpleaños número 18 ya es mayor. Si es menor, `apoderado` (nombres, apellidos, DNI,
    teléfono y parentesco; correo opcional) es obligatorio, y sin él responde 400 en `apoderado`. Si es mayor, enviar
    `apoderado` responde 400. El DNI del apoderado no puede ser igual al del alumno (400 en `apoderado.dni`). Pruebas en
    el borde del cumpleaños con `RELOJ` (23:59 del día anterior y 00:00 del día en Lima) y del 29 de febrero. _(crítico)_
    (RN-20, RNF-05)
14. **Consentimientos con evidencia.** `consentimientos` trae `version`, `datosPersonales`, `deslinde` e `imagen`.
    `datosPersonales` y `deslinde` deben ser `true` (literal), si no, 400; `imagen` es opcional y su valor se guarda
    (provisional, N7). Si `version` no es la vigente, responde 409 `TEXTOS_ACTUALIZADOS` con los textos vigentes, sin
    escribir. Al aceptar se guarda una fila de `consentimientos` por cada tipo aceptado, con la versión, "ahora", la IP
    (`ipParaAuditoria`) y quién lo otorga (`TITULAR`, o `APODERADO` si es menor). El texto de datos personales menciona
    de forma expresa los datos de salud y, si es menor, los de menores (RNF-05). Los textos viven en
    `packages/contratos/src/consentimientos.ts` con su versión (provisionales, N7). _(crítico)_ (HU-01, D-07, RNF-05)
15. **Plan y clases válidos.** Dado el cuerpo válido, entonces:
    - a) un `planId` que no existe, de otra academia, inactivo, programado o vencido hoy, o que no aplica al `nivel`
      elegido, responde 409 `PLAN_NO_DISPONIBLE`, con el mismo cuerpo en todos los casos;
    - b) las `claseIds` deben ser exactamente `vecesPorSemana` clases, en días distintos (una por día, provisional N4),
      todas activas, del `nivel` elegido, en un día de `diasPermitidos` y en una franja de `franjasPermitidas` del plan;
      si no, 409 `SELECCION_NO_VALIDA` con `detalles.errores[]` (por clase o por la lista). Un id que no existe o de
      otra academia da ese mismo 409, sin distinguirlo de una clase inactiva;
    - c) si las clases elegidas no tienen ninguna clase restante en el mes, 409 `SIN_CLASES_EN_EL_MES`.

    Ninguno escribe, audita ni envía correo. _(crítico)_ (HU-02, RN-07, RN-08, D-15, DR-2 de 004)
16. **Envío correcto y reserva.** Dados un cuerpo válido, cupo en todas las clases elegidas y un DNI libre (criterio
    21), entonces en una sola transacción se crean el alumno en estado `CLIENTE` (con su nivel), su ficha médica, el
    apoderado si es menor, los consentimientos, la solicitud `PENDIENTE_PAGO` y la matrícula `RESERVADA` del mes en curso
    con sus clases (`matricula_clases`), `fecha_inicio` hoy, `fecha_fin` el último día del mes, `clases_totales`,
    `clases_usadas` 0, `es_proporcional`, `precio_plan` y `clases_por_mes_plan` copiados del plan, `monto_calculado` del
    criterio 9 y `reserva_vence_en` igual al vencimiento de la reserva sin pago (el menor entre "ahora" más 24 horas y el
    fin del mes en Lima, criterio 54). Responde 201 con
    `{ solicitud: { codigo, token, enlace, estado: 'PENDIENTE_PAGO', reservaVenceEn, cotizacion } }`, donde `enlace` es
    `/a/{nombreCorto}/solicitud/{token}`. Desde ese momento la ocupación de cada clase elegida sube en 1. No se crea
    ningún usuario, carnet ni pago (007). _(crítico)_ (HU-01, HU-02, RN-01, RN-27, RN-28, D-05) _(ajustado por el
    criterio 54, respuesta R1, ronda 1)_
17. **Sin cupo.** Si alguna clase elegida no tiene cupos restantes al momento de enviar, responde 409 `SIN_CUPO` con
    `detalles.clasesSinCupo` (los ids de las clases llenas, todas las que lo estén), sin escribir, auditar ni enviar
    correo; la web pide otra opción (HU-02). Una clase con el aforo bajado por debajo de sus inscritos (DR-5 de 004) no
    tiene cupo. _(crítico)_ (HU-02, RN-11)
18. **El último cupo, a la vez.** Pruebas deterministas, sin depender de tiempos:
    - a) una clase de aforo 20 con 19 matrículas que ocupan cupo; dos envíos simultáneos de personas distintas por esa
      clase: exactamente uno responde 201 y el otro 409 `SIN_CUPO`; la ocupación queda en 20;
    - b) aforo 20 con 18 ocupados y diez envíos simultáneos: exactamente dos 201 y ocho 409; ocupación 20;
    - c) una transacción de la prueba bloquea la clase (`bloquearClasesParaCupo`) y confirma una matrícula que llena el
      aforo; el envío, que quedó esperando (comprobado en `pg_locks`), responde 409 después de la confirmación;
    - d) dos envíos con las clases `[c1, c2]` y `[c2, c1]` a la vez terminan los dos, sin `40P01` ni 500;
    - e) un envío por el último cupo y un `PATCH /api/clases/{id}` del administrador que baja el aforo a la ocupación
      actual con confirmación (criterio 41), a la vez: nunca queda una ocupación mayor que el aforo resultante por una
      inscripción nueva.

    El envío llama a `bloquearClasesParaCupo(tx, claseIds)` una sola vez, con todas las clases, antes de contar la
    ocupación o escribir (regla "Cupo de una clase" de 004). _(crítico)_ (RN-11, RN-28; criterio 23 de 004)
19. **El monto que se ve es el que se guarda.** El cuerpo trae `inscripcion.mes` y `inscripcion.montoMostrado` (los de la
    cotización que vio el cliente). Si `mes` no es el mes en curso, responde 409 `MES_CAMBIO`; si el monto calculado al
    enviar (con el precio del plan en ese momento y "ahora") no es igual a `montoMostrado`, responde 409 `MONTO_CAMBIO`
    con la cotización nueva en `detalles.cotizacion`. Ninguno escribe nada. Pruebas: un envío a las 23:59:59 del 30 de
    noviembre en Lima con la cotización de noviembre, procesado a las 00:00:00 del 1 de diciembre (`MES_CAMBIO`); el
    administrador cambia el precio entre la cotización y el envío (`MONTO_CAMBIO`); empieza una de las clases de hoy
    entre la cotización y el envío (`MONTO_CAMBIO` si el monto baja). Todo monto que la cotización puede dar se puede
    enviar como `montoMostrado`, también el de 100000.00 (criterio 50). _(crítico)_ (HU-34, HU-19, D-03) _(ajustado por
    el criterio 50, ataque ronda 1)_
20. **Las reservas vencen solas.** Dada una matrícula `RESERVADA` cuya `reserva_vence_en` es anterior o igual a "ahora",
    entonces no ocupa cupo: los cupos restantes del criterio 6, el criterio 17 y los inscritos de DR-5 la ignoran, sin
    que ninguna tarea programada la cambie. Con `RELOJ` fijo: un segundo antes del vencimiento ocupa el cupo; en el
    instante del vencimiento ya no. La solicitud se muestra como `VENCIDA` (criterio 32). No hay tarea programada en esta
    historia. _(crítico)_ (RN-28, pregunta N1)
21. **DNI ya registrado.** Dado el DNI del formulario, entonces:
    - a) si es de un alumno de la academia que no está en estado `CLIENTE`, de un cliente con una solicitud activa, o de
      un usuario del personal de la academia (`usuarios`), responde 409 `DNI_YA_REGISTRADO` con el mismo cuerpo en los
      tres casos (sin decir cuál), sin escribir nada ni enviar correo;
    - b) si es de un cliente sin solicitud activa (sus solicitudes anteriores vencieron o se cancelaron), el envío se
      acepta: se actualizan sus datos personales, su ficha y su apoderado (o se quita, si ya es mayor), sus solicitudes
      `PENDIENTE_PAGO` vencidas pasan a `VENCIDA` y sus matrículas `RESERVADA` vencidas a `CANCELADA`, y se crean la
      solicitud y la matrícula nuevas (provisional, N6);
    - c) el mismo DNI en otra academia no cuenta (D-28).

    _(crítico)_ (HU-01, RN-03, D-28)
22. **El mismo DNI, a la vez.** Dados dos envíos simultáneos con el mismo DNI nuevo (y distinta `claveIdempotencia`),
    exactamente uno responde 201 y el otro 409 `DNI_YA_REGISTRADO`; queda un alumno, una solicitud y una matrícula. Lo
    mismo con un DNI de un cliente sin solicitud activa (caso 21 b). Nunca 500 ni `40P01`. _(crítico)_ (RN-03, D-28)
23. **Envíos repetidos.** Dado un envío que ya creó su solicitud, cuando llega otro con la misma `claveIdempotencia` y el
    mismo DNI en la misma academia (doble clic o reintento tras un corte de red), entonces responde 409
    `SOLICITUD_YA_REGISTRADA` con `detalles.codigo` (el código de la solicitud, nunca el token), sin escribir, auditar ni
    enviar otro correo; el cliente sigue su solicitud con el código y su DNI (criterio 30). La misma clave con otro DNI
    responde 409 `SOLICITUD_YA_REGISTRADA` sin `detalles` (no revela el código de otra persona). Dos envíos simultáneos
    con la misma clave y el mismo DNI: uno 201 y el otro 409 `SOLICITUD_YA_REGISTRADA` con el código; queda una sola
    solicitud. La misma clave en otra academia no cuenta. _(crítico)_ (regla de idempotencia de `CLAUDE.md`)
24. **Código y token.** El código es `AQ-` seguido de 6 caracteres del alfabeto de Crockford en mayúsculas (sin I, L, O
    ni U; por ejemplo `AQ-7F3K9X`), elegidos con un generador criptográfico, único por academia (si choca, se elige otro
    dentro de la misma transacción). El token tiene 32 bytes de un generador criptográfico, en base64url sin relleno (43
    caracteres); en la base solo se guarda su SHA-256 (`token_hash`), nunca el token. El token en claro aparece solo en la
    respuesta 201 y en el correo; nunca en la base, la auditoría, el registro técnico ni otra respuesta. Prueba: 1000
    envíos dan 1000 tokens y códigos distintos, sin orden ni prefijo común entre envíos seguidos. _(crítico)_ (D-05,
    D-07)
25. **Límite de reservas sin pagar por conexión.** Dada una IP con 5 solicitudes activas (provisional, N8) creadas desde
    ella en la academia, cuando envía otra, entonces responde 409 `LIMITE_DE_RESERVAS_PENDIENTES` sin escribir. Las
    vencidas, canceladas y las de otra academia no cuentan. La IP de origen se guarda en la solicitud. "Desde ella"
    se entiende por clave de conexión: las IPv6 del mismo bloque /64 cuentan juntas (criterio 60). _(crítico)_
    (riesgo de 11.4: cupos bloqueados) _(ajustado por el criterio 60, respuesta R4, ronda 1)_
26. **Auditoría.** Cada envío correcto registra `SOLICITUD_INSCRIPCION_CREADA` (entidad `solicitud_inscripcion`,
    `entidadId` el id de la solicitud, actor `PUBLICO` sin id, la IP) con `datosDespues` = `codigo`, `planId`,
    `claseIds`, `mes`, `clasesTotales`, `montoCalculado`, `esProporcional`, `menorDeEdad` y `reservaVenceEn`. Nunca lleva
    el DNI, nombres, fecha de nacimiento, contacto, datos médicos, apoderado, token ni foto. Los rechazos (400, 409, 429)
    no se auditan. _(crítico)_ (RN-22, RNF-06, Ley 29733; pregunta T2)
27. **Correo después de confirmar.** Si el formulario trae correo, después de confirmar la transacción se llama una vez a
    `EnviadorCorreo.enviar` con el enlace de seguimiento y el código; si el alumno es menor y el apoderado dio correo,
    una vez por cada destinatario distinto (criterio 57). Si la transacción falla, no se llama. Si el envío
    del correo falla, la respuesta sigue siendo el 201 y el fallo queda en el registro técnico (sin el destinatario ni
    el enlace, y solo con el tipo del error: criterio 52). La respuesta 201 no espera al correo (criterio 51). La
    implementación simulada (D-19) registra solo la plantilla, la academia y que hubo un envío; nunca el
    destinatario, el enlace ni el token (pregunta T8). _(crítico)_ (D-05, D-19; efectos después de confirmar)
    _(ajustado por los criterios 51 y 52, ataque ronda 1, y por el criterio 57, respuesta R2, ronda 1)_
28. **Registro técnico sin datos sensibles.** En ningún nivel, el registro técnico de las rutas de esta historia lleva el
    DNI, nombres, fecha de nacimiento, teléfono, correo, dirección, datos médicos, apoderado, token, código junto con el
    DNI, el cuerpo de la petición ni el contenido de la foto; la línea de la petición de `pino-http` no lleva cuerpo ni
    token (el token nunca va en una dirección de la API, y la cabecera `Referer`, que puede llevar la dirección de la
    página de seguimiento, se redacta: criterio 53). Prueba con un registro en memoria que envía un formulario
    completo, consulta y sube una foto, y busca cada valor. _(crítico)_ (criterio 43 de 002, Ley 29733) _(005a sin la
    foto; la subida de la foto, en la 005b: ver "División en 005a y 005b".)_ _(ajustado por los criterios 52 y 53,
    ataque ronda 1)_

### E. Seguimiento de la solicitud

29. **Consulta con el token.** `POST /api/a/{nombreCorto}/solicitudes/consulta` con `{ token }` responde 200 con
    `{ solicitud: VistaSolicitud, academia: { nombre, telefono } }` si el SHA-256 del token es el de una solicitud de esa
    academia. El token viaja en el cuerpo, nunca en la dirección de la API. _(crítico)_ (D-05, D-27)
30. **Consulta con el código y el DNI.** La misma ruta con `{ codigo, dni }` responde lo mismo si los dos coinciden con
    la misma solicitud de la academia. El código se recorta y se pasa a mayúsculas antes de buscarlo (`aq-7f3k9x`
    encuentra `AQ-7F3K9X`); el DNI se recorta, y uno que no tiene 8 dígitos responde el 404 del criterio 31. La búsqueda
    es una sola consulta con las dos condiciones.
    _(crítico)_ (D-05)
31. **Un solo 404.** Responden el mismo 404 `SOLICITUD_NO_ENCONTRADA`, con el mismo cuerpo: un token que no existe, uno
    de otra academia, uno con formato inválido (otro largo u otro alfabeto), un código que no existe o con formato
    inválido, un código que existe con otro DNI y un código de otra academia. Nada en la respuesta (cuerpo, cabeceras)
    distingue un código existente con otro DNI de uno inexistente. Un cuerpo con token y código a la vez, o sin ninguno
    de los dos, responde 400 `SOLICITUD_INVALIDA`. _(crítico)_ (D-05, D-23)
32. **Vista mínima.** `VistaSolicitud` (esquema estricto) tiene solo: `codigo`; `estado` (`PENDIENTE_PAGO`, `VENCIDA` o
    `CANCELADA`; la 007 suma los suyos); `creadaEn`; `reservaVenceEn` (solo en `PENDIENTE_PAGO`); `nombres`, que lleva
    solo el primer nombre de pila (DR-9): la primera palabra de `alumnos.nombres` (sin los demás nombres ni apellidos;
    P2); `plan` (`nombre`); `clases` (`nivel`, `diaSemana`, `horaInicio`, `horaFin`); `mes` (texto `AAAA-MM`, P8);
    `clasesTotales`; `monto` (texto con dos decimales, como `"42.00"`, P8); `esProporcional`; y `fotoCargada`
    (booleano). Nunca lleva DNI, apellidos, fecha de nacimiento, edad, teléfono, correo, dirección, datos médicos,
    apoderado, consentimientos, foto, ids internos (alumno, matrícula, solicitud) ni el hash del token. Una solicitud
    `VENCIDA` o `CANCELADA` muestra lo mismo sin `reservaVenceEn`: la clave no está en el objeto (ni con `null` ni con
    `undefined` serializado; P3) (provisional, N9). Desde la respuesta R3, tampoco llevan `nombres` ni `fotoCargada`
    (vista reducida, criterio 58). _(crítico)_ (RNF-05, Ley 29733, D-05) _(ajustado por el criterio 58, respuesta R3,
    ronda 1)_

### F. Límites de peticiones de las rutas públicas

33. **Límites por IP.** Las rutas públicas de `/api/a` cuentan las peticiones por IP con el almacén de
    `@nestjs/throttler`, antes de leer el cuerpo y antes de buscar la academia (como el ingreso de 002), sumando todas
    las academias, con estos límites provisionales (pregunta T7): `GET /api/a/{nombreCorto}` y
    `GET /api/a/{nombreCorto}/inscripcion`, 60 por minuto en total; la cotización, 30 por minuto; el envío, 10 por hora;
    la consulta de seguimiento, 10 por minuto; la foto, 10 por hora. El límite de 10 por minuto del ingreso (002) no
    cambia. Pasado el límite responde 429 `DEMASIADAS_SOLICITUDES` con `Cache-Control: no-store`, sin leer el cuerpo,
    sin abrir transacción y sin escribir. Cada límite tiene su contador: agotar uno no afecta a los otros. Las
    peticiones `HEAD` cuentan como `GET` (criterio 49). "Por IP" se entiende por clave de conexión: IPv4 exacta e IPv6
    por bloque /64 (criterio 59). _(crítico)_ (nota O2 de 001, DT-1 de 002) _(005a sin el límite de la foto, que llega
    con su ruta en la 005b.)_ _(ajustado por el criterio 49, ataque ronda 1, y por el criterio 59, respuesta R4, ronda
    1)_

### G. Foto opcional **[005b, siguiente PR]**

Los criterios 34 a 37 son de la 005b.

34. **[005b] Subida de la foto.** `PUT /api/a/{nombreCorto}/solicitudes/foto`, con el token en la cabecera `X-Token-Solicitud`
    y la imagen como cuerpo binario (`Content-Type: image/jpeg` o `image/png`), responde 204 si el token es de una
    solicitud `PENDIENTE_PAGO` no vencida de la academia cuyo alumno está en estado `CLIENTE`. Responde: 404
    `SOLICITUD_NO_ENCONTRADA` (el mismo del criterio 31) sin token o con un token que no sirve; 409
    `SOLICITUD_NO_EDITABLE` si la solicitud está vencida o cancelada; 400 `IMAGEN_NO_VALIDA` con otro tipo de contenido,
    con un `Content-Encoding` distinto de `identity`, si los primeros bytes no son de JPEG o de PNG, si la imagen no se
    puede decodificar, si tiene menos de 100 o más de 8000 píxeles por lado o más de 40 megapíxeles (provisionales); y
    413 `CARGA_EXCESIVA` con más de 5 MB, sin leer más allá del límite. Una foto nueva reemplaza a la anterior. Ningún
    rechazo cambia la foto guardada. _(crítico)_ (D-20, D-24; límites de `CLAUDE.md`)
35. **[005b] La foto que se guarda.** La imagen aceptada se vuelve a codificar con `sharp` como JPEG de como mucho 800 píxeles
    en su lado mayor (sin agrandar), con la orientación aplicada y **sin metadatos** (EXIF, GPS, XMP, ICC, comentarios):
    lo guardado nunca es el archivo original. Prueba: una foto con coordenadas GPS en su EXIF se guarda sin ellas; un PNG
    con un trozo de texto o un JPEG con datos después del final de la imagen se guardan sin ellos; un archivo poliglota
    (PNG válido con otro contenido pegado) se guarda solo como la imagen recodificada. _(crítico)_ (RNF-05: fotos de
    menores)
36. **[005b] `AlmacenArchivos` y aislamiento de archivos.** La interfaz `AlmacenArchivos` (`guardar`, `leer`, `borrar`) recibe
    siempre la academia y una clave que genera el servidor (`academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`),
    nunca un nombre que venga del cliente. La implementación de disco local escribe bajo el directorio de
    `ALMACEN_DIRECTORIO` y rechaza toda clave que no cumpla el formato o que, resuelta, quede fuera de ese directorio o de
    la carpeta de la academia (`..`, rutas absolutas, separadores de Windows, bytes nulos, enlaces simbólicos). Leer o
    borrar con la academia A una clave de B falla sin tocar el archivo. Ninguna ruta de la API ni del servidor de la web
    sirve ese directorio. _(crítico)_ (D-21, D-23)
37. **[005b] Archivo y transacción, sin restos visibles.** La imagen se procesa y se guarda con una clave nueva antes de la
    transacción; la transacción vuelve a comprobar la solicitud, guarda la clave en `alumnos.foto_clave` y confirma; después
    se borra el archivo anterior. Si la transacción falla, se borra el archivo nuevo y la clave guardada no cambia; si
    falla el borrado del anterior, se registra un aviso (sin datos personales) y la respuesta sigue siendo 204. Dos
    subidas simultáneas con el mismo token dejan una sola foto, la de la última en confirmar, y no dejan un archivo
    referenciado que no exista. Sin auditoría (la foto no es una operación de caja, pago ni horario); la acción queda en
    el registro técnico sin datos personales. _(crítico)_ (efectos después de confirmar; D-21)

### H. Panel: solicitudes, ocupación y aforo con inscritos

Los criterios 38 a 40 son de la 005b **[005b, siguiente PR]**; los 41 y 42 (DR-5 de 004 en la API) son de la 005a.

38. **[005b] Lista de solicitudes.** `GET /api/solicitudes`, con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y
    `SECRETARIA`), responde 200 con `{ solicitudes }` de la academia de la sesión, de la más nueva a la más antigua, las
    200 más recientes, filtradas por `?estado=` (`ACTIVAS` por defecto, `VENCIDAS`, `CANCELADAS` o `TODAS`); cada una con
    `id`, `codigo`, `estado` (con `VENCIDA` calculado), `creadaEn`, `reservaVenceEn`, `nombres`, `apellidos`, `dni`,
    `telefono`, `menorDeEdad`, `plan` (`id`, `nombre`), `clases`, `mes`, `clasesTotales` y `monto`. Sin datos médicos,
    apoderado, consentimientos, foto, IP ni token. `ENTRENADOR` y `ALUMNO` reciben 403; sin sesión, 401; el Superadmin
    no tiene la ruta (D-29). Nunca aparecen solicitudes de otra academia, tampoco con `?academiaId=`. La lectura no
    audita. _(crítico)_ (sección 2.1, RN-21, D-23)
39. **[005b] Cancelar una solicitud.** `POST /api/solicitudes/{id}/cancelar` con `{ motivo }` (de 3 a 200 caracteres
    visibles), con el mismo permiso: dentro de su `conAcademia`, `bloquearActorVigente` primero, después la solicitud
    (`FOR UPDATE`) y después `bloquearClasesParaCupo` con sus clases. Una solicitud `PENDIENTE_PAGO` (vencida o no) pasa a
    `CANCELADA` y su matrícula a `CANCELADA`: el cupo se libera en ese momento. Registra
    `SOLICITUD_INSCRIPCION_CANCELADA` (actor `USUARIO`, `motivo`, `datosAntes` y `datosDespues` con el estado) y responde
    200 con la solicitud. Una ya `CANCELADA` responde 200 sin escribir ni auditar (dos cancelaciones dejan una
    auditoría); un id que no existe, de otra academia o que no es UUID, 404 `NO_ENCONTRADO`. Con el actor desactivado
    mientras espera, 401 sin escribir (prueba de carrera como el criterio 7 de 004). _(crítico)_ (RN-22, RN-28, DT-5 de
    002)
40. **[005b] Ocupación para el administrador.** `GET /api/clases/ocupacion`, con
    `@Permiso('CONFIGURAR_PLANES_HORARIOS_AFORO')`, responde 200 con `{ mes, ocupacion: [{ claseId, inscritos,
    cuposRestantes }] }` de todas las clases de la academia en el mes en curso (las que no tienen inscritos, con 0).
    `claseSchema` y `GET /api/clases` de 004 no cambian. _(prueba obligatoria; permisos y aislamiento como el criterio 5
    de 004)_ (HU-17, R11 como dato)
41. **Bajar el aforo por debajo de los inscritos (DR-5 de 004).** `PATCH /api/clases/{id}` con un `aforo` menor que los
    inscritos de la clase responde 409 `AFORO_MENOR_QUE_INSCRITOS` con `detalles.inscritos`, sin escribir ni auditar,
    salvo que el cuerpo traiga `confirmarAforoMenor: true`; con la confirmación se guarda (200), nadie pierde su lugar y
    la clase no recibe inscripciones nuevas hasta que su ocupación baje del aforo. La auditoría `CLASE_ACTUALIZADA`
    suma `inscritos` y `confirmacion: 'AFORO_MENOR_QUE_INSCRITOS'` en `datosDespues`. Los inscritos se cuentan después de
    `bloquearClasesParaCupo` (criterio 22 de 004), así que un envío simultáneo se ordena con el cambio (criterio 18 e).
    Un aforo mayor o igual que los inscritos se guarda como en la 004 (`confirmarAforoMenor` se ignora). _(crítico)_
    (HU-17, RN-11, DR-5 de 004)
42. **No se desactiva una clase con inscritos (DR-5 de 004).** `PATCH /api/clases/{id}` con `activo: false` sobre una
    clase con inscritos responde 409 `CLASE_CON_INSCRITOS` con `detalles.inscritos`, sin escribir ni auditar. Sin
    inscritos (o con todas sus reservas vencidas o canceladas), se desactiva como en la 004. Un envío simultáneo por esa
    clase y la desactivación se ordenan por el bloqueo de la clase: o el envío entra primero y la desactivación da 409, o
    la desactivación entra primero y el envío da `SELECCION_NO_VALIDA`. _(crítico)_ (DR-5 de 004)

### I. Web

43. **Formulario de inscripción.** `/a/{nombreCorto}/inscripcion` (sin sesión, para el celular y la PC de recepción)
    muestra el nombre y el teléfono de la academia y guía por pasos: datos personales; ficha médica; apoderado (aparece
    y se exige solo si la fecha de nacimiento da menos de 18 años en la fecha de Lima); nivel, plan (solo los que aplican
    a ese nivel) y clases (solo las del nivel con cupo, en los días y franjas del plan, una por día, tantas como
    `vecesPorSemana`, con los cupos restantes de cada una); foto opcional (con vista previa, y aviso si no es JPG ni PNG
    o pasa de 5 MB antes de subirla); y un resumen con la cotización (monto en soles, "proporcional: N de M clases" si
    corresponde, y que el precio ya incluye IGV, D-03) y las casillas de los consentimientos con sus textos. Valida con
    los esquemas compartidos, genera la `claveIdempotencia` una vez por formulario, desactiva el envío mientras espera y
    muestra al terminar el código y el enlace con un aviso para guardarlos y un botón para copiarlos. Ante `SIN_CUPO`
    marca las clases llenas, vuelve a pedir la oferta y pide otra opción; ante `MONTO_CAMBIO`, `MES_CAMBIO` o
    `TEXTOS_ACTUALIZADOS`, muestra lo nuevo y pide confirmar; ante `DNI_YA_REGISTRADO`, `SOLICITUD_YA_REGISTRADA`,
    `LIMITE_DE_RESERVAS_PENDIENTES` y 429, un mensaje claro con el teléfono de la academia. Si la foto falla después de
    crear la solicitud, la solicitud queda creada y la página de seguimiento permite volver a subirla. _(prueba
    obligatoria, de componentes)_ (HU-01, HU-02, D-05, D-20, D-24) _(005a sin el paso de la foto ni su reintento, que
    son de la 005b.)_
44. **Página de seguimiento.** `/a/{nombreCorto}/solicitud/{token}` consulta con el token en el cuerpo y muestra la vista
    mínima (estado en palabras, plan, días y horas, mes, monto, fecha límite de la reserva, teléfono de la academia y
    "subir foto" mientras se pueda). `/a/{nombreCorto}/solicitud` ofrece la consulta con código y DNI. La página no guarda
    el token en `localStorage`, `sessionStorage` ni cookies, declara `<meta name="referrer" content="no-referrer">`, no
    carga recursos de otros dominios y no muestra el token en el título. La clave de la consulta en TanStack Query no se
    persiste. Con la vista reducida (criterio 58, sin `nombres`), la página muestra el estado y los datos de la
    solicitud sin saludar por el nombre ni dejar un hueco. _(prueba obligatoria, de componentes)_ (D-05, D-27) _(005a
    sin "subir foto", que es de la 005b.)_ _(ajustado por el criterio 58, respuesta R3, ronda 1)_
45. **Teléfono en las páginas públicas.** El ingreso de la academia (`/a/{nombreCorto}/ingresar`, de 002), la inscripción
    y el seguimiento muestran el teléfono de la academia cuando existe, leído de `GET /api/a/{nombreCorto}` sin caché
    entre visitas (DR-4 de 003). _(prueba obligatoria, de componentes)_
46. **[005b] Panel.** El inicio del panel muestra "Solicitudes de inscripción" a `ADMIN` y `SECRETARIA` (según
    `puede(rol, 'REGISTRAR_INSCRIPCION_Y_COBRO')`) y "Nueva inscripción", que abre el formulario público de la academia
    en recepción (pregunta N10). `/panel/solicitudes` lista con filtro por estado y cancela con un diálogo que pide el
    motivo. `/panel/clases` muestra en cada clase "inscritos / aforo" y, al bajar el aforo por debajo de los inscritos,
    un diálogo de confirmación que reenvía con `confirmarAforoMenor: true`; al desactivar una clase con inscritos,
    explica que primero hay que moverlos o cancelar sus solicitudes. Las claves de las consultas incluyen la identidad de
    la sesión y los formularios cumplen las lecciones de la 003 (criterio 29 de 004). _(prueba obligatoria, de
    componentes)_

### J. Semilla y documentación

47. **Semilla.** `delfines` tiene, inventados, un cliente con una solicitud `PENDIENTE_PAGO` vigente, uno con una
    reserva vencida y uno menor de edad con apoderado, sobre los planes de la 004 y sus clases, más las que sume esta
    historia; ninguna clase queda por encima de su aforo. `tiburones` queda sin solicitudes. Se puede ejecutar dos veces
    sin duplicar ni pisar lo editado (una clase que el administrador cambió o desactivó no se reactiva ni se vuelve a
    crear). Los tokens de la semilla no se imprimen ni se guardan en claro (solo sus hashes); los datos médicos son
    inventados y neutros. Además _(ataque ronda 1)_:
    - a) **Cada plan de ejemplo se puede usar.** Para cada plan de ejemplo de `delfines` hay al menos un nivel de sus
      `nivelesAplicables` con `vecesPorSemana` clases activas de ese nivel, en días distintos de `diasPermitidos`, en
      franjas de `franjasPermitidas` y con cupos restantes, es decir, una selección que cumple el criterio 15 b. Hoy no
      la hay: el plan de 2 veces (martes y jueves) no tiene clases esos días y el de 3 veces (lunes, miércoles y viernes)
      no tiene tres días de un mismo nivel.
    - b) **Las matrículas de ejemplo son las que el formulario habría creado.** Cada una tiene tantas clases como
      `vecesPorSemana` de su plan, del nivel del alumno, una por día y en los días y franjas del plan; `clases_totales`
      no pasa de `clases_por_mes_plan`, y `monto_calculado` es `montoProporcional(precio_plan, clases_por_mes_plan,
      clases_totales)`.
    - c) **Sin romper las semillas anteriores.** Siguen valiendo lo que fijan la 002 (criterio 45: los mismos usuarios
      de ejemplo, sin usuarios nuevos) y la 004 (criterio 30 y su prueba de la semilla: los dos planes con sus días,
      franjas y niveles; clases activas de los tres niveles con aforo de 20 a 50; al menos un bloque con dos clases, y en
      todo bloque con dos o más clases, niveles y entrenadores distintos; repetirla no pisa lo que el administrador
      cambió).
    - d) **Ninguna reserva de ejemplo cruza el mes** _(respuesta R1, ronda 1)_. Las matrículas de ejemplo son del mes en
      curso al sembrar (fecha de Lima con el reloj real, porque la semilla no usa `RELOJ`). La reserva vigente vence al
      fin del mes en Lima (el tope de DR-12; ya no "una fecha lejana") y la vencida, en un instante anterior al de
      sembrar; ninguna `reserva_vence_en` de la semilla es posterior al fin del mes de su matrícula (el `CHECK` del
      criterio 56 lo impide). Por eso la solicitud vigente de ejemplo deja de serlo al terminar el mes; volver a
      ejecutar la semilla el mes siguiente no la renueva (no pisa lo existente): para tener otra, se envía el formulario.

    _(verificación del revisor y prueba no protegida: después de la semilla, con `RELOJ` fijo en el día 1 del mes en
    curso a las 00:00 de Lima, un envío por la API con una selección de las clases sembradas responde 201 con cada plan
    de ejemplo; ninguna matrícula sembrada tiene `reserva_vence_en` posterior al fin de su mes; y las pruebas de la
    semilla de 002 y 004 siguen pasando)_ _(ajustado en el ataque ronda 1 y por la respuesta R1, ronda 1)_
48. **Documentación.** `docs/arquitectura.md` documenta las tablas, la ocupación (`contarOcupacion`), el orden de
    bloqueos, `AlmacenArchivos`, `EnviadorCorreo`, los límites de las rutas públicas y las "Reglas para las historias
    siguientes" de esta spec; el `README.md` y la guía de uso explican la inscripción, el seguimiento y el panel de
    solicitudes; `.env.example` suma `ALMACEN_DIRECTORIO`. _(verificación del revisor)_ _(005a sin `AlmacenArchivos`,
    la regla "Archivos", `ALMACEN_DIRECTORIO` ni el panel de solicitudes, que documenta la 005b.)_

### K. Ronda 1 adversarial (005a)

Fallas encontradas en la ronda 1 del ataque de la 005a (T20, 20/11/2026), agregadas antes de tocar el código. Todos los
criterios de esta sección son de la 005a, de ruta crítica y llevan pruebas protegidas nuevas, en archivos nuevos (sin
modificar las protegidas ya escritas). Origen de cada uno: "ataque ronda 1".

49. **`HEAD` cuenta como `GET` en los límites por IP (amplía el 33).** Express atiende un `HEAD` con el manejador del
    `GET`, así que toda ruta pública de `/api/a` que tiene límite para `GET` lo tiene también para `HEAD`, con el **mismo
    contador**. En la 005a: `GET` y `HEAD` de `/api/a/{nombreCorto}` y de `/api/a/{nombreCorto}/inscripcion` suman en el
    contador "lectura" de 60 por minuto por IP (también con mayúsculas distintas o barra final, como el `GET`). Pruebas,
    cada una con un almacén limpio:
    - a) 60 `HEAD /api/a/{nombreCorto}` desde una IP y después un `GET` (de cualquiera de las dos rutas): el `GET`
      responde 429 `DEMASIADAS_SOLICITUDES`;
    - b) 60 `GET` y después un `HEAD` (de cualquiera de las dos rutas): 429 con `Cache-Control: no-store`, sin buscar la
      academia ni abrir transacción;
    - c) pasado el límite, un `HEAD` con un nombre corto que existe y uno con un nombre corto que no existe responden el
      mismo 429: el `HEAD` ya no distingue una academia existente (200) de una inexistente (404);
    - d) mezclando `GET` y `HEAD` sobre las dos rutas, la petición número 61 del minuto es la primera en responder 429.

    Los demás contadores (cotización, envío, consulta, ingreso de 002) no cambian: un `HEAD` nunca cuenta en ellos ni
    agota el de lectura de otra IP. _(crítico)_ (criterio 33, nota O2 de 001; ataque ronda 1, F1. Causa: las reglas de
    `LIMITES_PUBLICOS` comparan el método con `'GET'` y un `HEAD` no coincide con ninguna.)
50. **El monto cotizado siempre se puede enviar (amplía el 12 y el 19).** Un plan puede tener un precio de hasta
    S/ 99999.99 (`montoSchema` de 004), y redondeado hacia arriba al sol entero (D-03) el monto de un mes completo puede
    llegar a S/ 100000.00. `montoMostrado` se valida con `montoCotizadoSchema` (nuevo, en `packages/contratos`): un texto
    con hasta dos decimales, mayor que 0 y como mucho `"100000.00"` (el máximo que se alcanza al redondear un precio
    válido), con las mismas reglas de forma que `montoSchema` (sin espacios, signos, exponentes ni comas). Acepta
    `"100000"`, `"100000.0"` y `"100000.00"`; responde 400 en `inscripcion.montoMostrado` con `"100000.01"`, `"100001"`
    y `"1000000"`. `montoSchema` y `MONTO_MAXIMO` de 004 no cambian (el precio de un plan sigue con tope 99999.99).
    Pruebas: con un plan de precio 99999.01 y otro de 99999.99, y una selección sin proporcional, la cotización responde
    200 con `monto` `"100000.00"`, y un envío con ese `montoMostrado` responde 201 y guarda `monto_calculado` 100000.00
    en la matrícula (y en la auditoría del criterio 26); con un `montoMostrado` distinto del calculado sigue
    respondiendo 409 `MONTO_CAMBIO`. Propiedad: para todo precio válido de `montoSchema` y todo `clasesTotales` de 1 a
    `clasesPorMes`, el monto de `montoProporcional` cumple `montoCotizadoSchema`. _(crítico)_ (RN-25, HU-34, D-03;
    criterios 9, 12 y 19; ataque ronda 1, F2)
51. **La respuesta no espera al correo (amplía el 27).** Después de confirmar la transacción, la API responde el 201 sin
    esperar a que `EnviadorCorreo.enviar` termine: el envío se inicia después de confirmar y la respuesta no depende de
    que su promesa se resuelva ni se rechace. Pruebas con un `EnviadorCorreo` de prueba cuya promesa no se resuelve
    nunca:
    - a) el envío responde 201 con la solicitud creada en menos de 2 segundos (margen de la prueba; la API no espera
      ningún tiempo al correo), y `enviar` se llamó una vez, después de confirmar (la solicitud ya se ve en la base desde
      otra conexión en el momento de la llamada);
    - b) un segundo envío de otra persona, mientras el primer correo sigue colgado, también responde 201 sin demora: un
      correo colgado no retiene conexiones de la base ni transacciones;
    - c) con un `enviar` que lanza un error de forma síncrona y con uno que rechaza su promesa, la respuesta es el mismo
      201 y el proceso no emite `unhandledRejection` ni `uncaughtException`.

    El reintento del cliente sigue cubierto por el criterio 23: no envía otro correo. _(crítico)_ (D-05, D-19; efectos
    después de confirmar, criterio 27; ataque ronda 1, F3. Causa: la respuesta espera a `correo.enviar`.)
52. **El fallo del correo se registra solo con su tipo (amplía el 27 y el 28).** Cuando `EnviadorCorreo.enviar` falla
    (rechaza o lanza), el registro técnico lleva un mensaje fijo, la academia, la plantilla y `error: { tipo }`, donde
    `tipo` es el nombre de la clase del error (el `name` de su constructor, si es un identificador de como mucho 64
    caracteres; si no, `"Error"`), o `typeof` del valor si no es un `Error`. Nunca lleva el mensaje del error, su pila,
    su `cause`, su `name` propio ni ninguna otra propiedad (`rejected`, `response`, `envelope`, `code`…), y no pasa el
    error a `errorParaRegistro` (que devuelve el `Error` completo). Pruebas con un registro en memoria y un enviador que
    falla con: un error de una clase propia con el destinatario y el enlace en el mensaje, `rejected: [destinatario]`,
    `response` con el destinatario y `cause` con el token; un `Error` con `name` igual al destinatario; un texto y un
    objeto con el destinatario y el token. En ningún nivel el registro contiene el destinatario, el enlace ni el token, y
    en el primer caso `tipo` es el nombre de la clase. _(crítico)_ (Ley 29733, criterio 43 de 002; criterios 27 y 28;
    ataque ronda 1, F4)
53. **El registro técnico no lleva la cabecera `Referer` (amplía el 28).** La página de seguimiento tiene el token en su
    dirección (`/a/{nombreCorto}/solicitud/{token}`, D-27) y un navegador puede mandar esa dirección en `Referer` a la
    API. En toda ruta de la API (públicas, del panel y de la plataforma, también en las respuestas de error y en las
    rechazadas por el límite), la línea de `pino-http` y cualquier otro registro técnico llevan `req.headers.referer`
    redactado con `TEXTO_REDACTADO` (como la cookie y `authorization`), en todos los niveles. Prueba con un registro en
    memoria en el nivel más detallado (`trace`) que manda `Referer: https://academia.test/a/{nombreCorto}/solicitud/{token}`
    en `GET /api/a/{nombreCorto}`, `GET …/inscripcion`, la cotización, un envío correcto, un envío rechazado (400 y
    409), una consulta con 200 y con 404, una petición rechazada con 429 y una ruta que no existe: el token no aparece en
    ninguna línea, y el valor redactado sí. _(crítico)_ (D-05, D-27, Ley 29733; criterio 43 de 002 y criterio 28;
    ataque ronda 1, F5. Causa: `RUTAS_REDACTADAS` solo cubre `cookie`, `authorization` y `set-cookie`.)

### L. Respuestas del responsable a la ronda 1 (005a)

Decisiones de Bryan del 20/11/2026 sobre las preguntas R1 a R4 de la ronda 1 (DR-12 a DR-15), agregadas antes de tocar
el código. Todos los criterios de esta sección son de la 005a, de ruta crítica y llevan pruebas protegidas nuevas, en
archivos nuevos (por ejemplo `…-respuestas-ronda1.test.ts`); la única prueba protegida existente que cambia es la del
criterio 32 para `VENCIDA` y `CANCELADA` (ver "Impacto en especificaciones anteriores"). Origen de cada uno: "respuesta
Rn, ronda 1".

54. **La reserva vence a las 24 horas o al fin del mes, lo que ocurra primero (amplía el 16).** La función pura
    `vencimientoDeReserva(ahora)` devuelve el menor entre `ahora + 24 h` y el fin del mes en Lima del mes de "ahora"
    (las 23:59:59.999 del último día del mes en America/Lima). El envío la usa para `matriculas.reserva_vence_en`, y ese
    mismo instante es el `reservaVenceEn` de la respuesta 201, el de `datosDespues` de la auditoría (criterio 26) y el de
    la vista de seguimiento mientras la solicitud está `PENDIENTE_PAGO`, siempre en ISO con milisegundos
    (`2026-12-01T04:59:59.999Z`). Pruebas unitarias, también con el proceso en `TZ=Asia/Tokyo` y en `TZ=UTC`:
    - a) `2026-11-11T15:00:00.000Z` (miércoles 11, 10:00 en Lima) → `2026-11-12T15:00:00.000Z` (24 horas);
    - b) `2026-11-30T15:00:00.000Z` (lunes 30, 10:00 en Lima) → `2026-12-01T04:59:59.999Z` (fin de mes, no el 1 de
      diciembre a las 10:00);
    - c) `2026-11-30T04:59:59.999Z` (23:59:59.999 del domingo 29 en Lima) → `2026-12-01T04:59:59.999Z` (las dos coinciden);
    - d) `2026-11-30T05:00:00.000Z` (00:00 del lunes 30 en Lima) → `2026-12-01T04:59:59.999Z` (fin de mes; las 24 horas
      darían el 1 de diciembre a las 00:00);
    - e) `2026-12-31T15:00:00.000Z` → `2027-01-01T04:59:59.999Z` (cambio de año);
    - f) `2027-02-28T15:00:00.000Z` → `2027-03-01T04:59:59.999Z` (febrero de 28 días) y `2028-02-28T15:00:00.000Z` →
      `2028-02-29T15:00:00.000Z` (año bisiesto: alcanzan las 24 horas);
    - g) `2026-12-01T04:59:59.999Z` (el último milisegundo de noviembre en Lima) → ese mismo instante;
    - h) propiedad, con instantes de todo el año 2026 y 2027 cada pocos minutos: el resultado nunca es anterior a
      "ahora", nunca pasa de `ahora + 24 h`, y cae en el mismo mes de Lima que "ahora".

    Pruebas de integración, con `RELOJ`: un envío el lunes 30 de noviembre a las 10:00 de Lima por una clase del lunes
    a las 18:00 responde 201 con `reservaVenceEn` `2026-12-01T04:59:59.999Z`, el mismo valor en la matrícula, en la
    auditoría y en la consulta de seguimiento; un envío el domingo 29 a las 10:00 de Lima da `2026-11-30T15:00:00.000Z`.
    _(crítico)_ (RN-28, DR-1, DR-12, RNF-12; respuesta R1, ronda 1)
55. **Al terminar el mes, la reserva ya no cuenta (amplía el 20, el 21 y el 25).** Con una solicitud enviada el lunes 30
    de noviembre a las 10:00 de Lima (vence `2026-12-01T04:59:59.999Z`) y `RELOJ` fijo:
    - a) a las 23:59:59.998 del 30 (`2026-12-01T04:59:59.998Z`) ocupa el cupo de noviembre y la consulta la muestra
      `PENDIENTE_PAGO` con `reservaVenceEn`; a las 23:59:59.999 ya no ocupa cupo (cupos restantes, `contarOcupacion` y
      `contarInscritos`) y la consulta la muestra `VENCIDA` con la vista reducida (criterio 58);
    - b) el martes 1 de diciembre a las 00:00 de Lima, un envío con el mismo DNI y clases con clases restantes en
      diciembre responde 201 (criterio 21 b, no `DNI_YA_REGISTRADO`): la solicitud de noviembre pasa a `VENCIDA`, su
      matrícula a `CANCELADA`, y la nueva matrícula es de diciembre con su propio vencimiento (criterio 54);
    - c) con 5 solicitudes activas creadas el 30 desde una conexión, un envío desde esa conexión a las 23:59:59.998 del
      30 responde 409 `LIMITE_DE_RESERVAS_PENDIENTES`, y uno el 1 de diciembre a las 00:00 responde 201 (las 5 ya
      vencieron);
    - d) nunca hay una matrícula `RESERVADA` con vencimiento de un mes ya cerrado que ocupe cupo o haga activa su
      solicitud: con "ahora" en diciembre, ninguna matrícula de noviembre cuenta en la ocupación ni en los inscritos de
      ninguna clase.

    Las mismas pruebas pasan con el proceso en `TZ=Asia/Tokyo`. _(crítico)_ (RN-11, RN-28, DR-12; criterios 20, 21 y
    25; respuesta R1, ronda 1)
56. **La base no acepta una reserva que cruce el mes.** `matriculas` tiene el `CHECK` `matriculas_reserva_dentro_del_mes`:
    `reserva_vence_en` es nula o anterior al inicio del mes siguiente al de `anio` y `mes` en America/Lima (para
    noviembre de 2026, anterior a `2026-12-01T05:00:00.000Z`). Un `INSERT` o un `UPDATE` directo, como app y como dueño
    de las tablas, falla con `23514`: una matrícula de noviembre de 2026 `RESERVADA` con `reserva_vence_en`
    `2026-12-01T05:00:00.000Z` o `2027-01-01T00:00:00.000Z`, y un `UPDATE` que lleva una reserva válida a
    `2026-12-01T05:00:00.000Z`. Se aceptan `2026-12-01T04:59:59.999Z` y `NULL`. Con diciembre de 2026, el límite es
    `2027-01-01T05:00:00.000Z` (cambio de año). El resultado es el mismo con la sesión en `SET TIME ZONE 'Asia/Tokyo'` y
    en `'UTC'`. Va en una migración nueva (`<marca>_reserva_dentro_del_mes`); las pruebas de catálogo de 001 siguen
    pasando. _(crítico)_ (RN-28, DR-12; criterio 4 c; respuesta R1, ronda 1)
57. **El enlace llega al alumno y al apoderado (amplía el 27).** Después de confirmar, el envío llama a
    `EnviadorCorreo.enviar` una vez por cada destinatario distinto, con la misma plantilla `SEGUIMIENTO_SOLICITUD`, el
    mismo código y el mismo enlace: el correo del alumno, si lo dio, y, si es menor y el apoderado dio correo, el del
    apoderado. "Distinto" se compara con los correos ya normalizados por el esquema (recortados y en minúsculas), sin
    otras equivalencias. Pruebas con un `EnviadorCorreo` que registra las llamadas:
    - a) menor con correo propio y del apoderado, distintos: dos llamadas, una con cada `para`;
    - b) menor con `Familia@Correo.test` en el alumno y ` familia@correo.test ` en el apoderado: una sola llamada;
    - c) menor sin correo propio y con correo del apoderado: una llamada, al apoderado; menor con correo propio y sin
      correo del apoderado: una, al alumno; sin ninguno: ninguna;
    - d) mayor de edad con correo: una, al alumno (no hay apoderado, criterio 13);
    - e) cliente que vuelve (criterio 21 b): se usan los correos del formulario nuevo, no los guardados antes;
    - f) los criterios 51 y 52 valen para cada envío: con el envío al alumno colgado y el del apoderado fallando (y al
      revés), la respuesta es el mismo 201 sin demora, los dos envíos se iniciaron, y el registro técnico tiene una
      línea de fallo con solo el tipo del error, sin ninguno de los dos destinatarios, el enlace ni el token; el envío
      simulado deja una línea por envío, sin destinatario;
    - g) un rechazo (400, 409, 429), un reintento con la misma `claveIdempotencia` (criterio 23) o el envío que pierde
      una carrera (criterio 22) no llaman a `enviar` para ninguno de los dos.

    _(crítico)_ (D-05, D-19, DR-13, RN-20, Ley 29733; criterios 27, 51 y 52; respuesta R2, ronda 1)
58. **Vista reducida de una solicitud que ya no es la vigente (amplía el 32).** La vista de seguimiento lleva `nombres`
    (y `fotoCargada`) solo si la solicitud es la vigente del cliente y su estado visible no es `VENCIDA` ni `CANCELADA`.
    En la 005a, la vigente del cliente es su única solicitud con estado visible distinto de `VENCIDA` y `CANCELADA` (hay
    como mucho una, por el índice del criterio 4 e y el criterio 21 b), así que la vista es reducida exactamente cuando
    el estado visible es `VENCIDA` o `CANCELADA`. La **vista reducida** tiene solo `codigo`, `estado`, `creadaEn`,
    `plan`, `clases`, `mes`, `clasesTotales`, `monto` y `esProporcional`, todos de esa solicitud y de su matrícula; las
    claves `nombres`, `fotoCargada` y `reservaVenceEn` no están (P3). Pruebas, por token y por código con DNI (las dos
    dan el mismo cuerpo):
    - a) una solicitud `VENCIDA` (en la fila) y una `CANCELADA`: las claves son exactamente las de la vista reducida, y
      el primer nombre del alumno no aparece en ninguna parte del cuerpo;
    - b) una `PENDIENTE_PAGO` un segundo antes de vencer muestra la vista completa con `nombres`; en el instante del
      vencimiento, la reducida;
    - c) regreso por un tercero (criterio 21 b): un cliente "Valeria" con su solicitud vencida S1; otro envío con el
      mismo DNI y el nombre "Intrusa" crea S2. La consulta de S1 muestra la vista reducida con el plan, las clases, el
      mes y el monto de S1 (no los de S2), y el cuerpo no contiene "Intrusa" ni "Valeria"; la de S2 muestra "Intrusa";
    - d) la solicitud de noviembre del criterio 55, consultada el 1 de diciembre, muestra la vista reducida;
    - e) `vistaSolicitudSchema` acepta la vista completa en `PENDIENTE_PAGO` y la reducida en `VENCIDA` y `CANCELADA`,
      y rechaza una `VENCIDA` o `CANCELADA` con `nombres` o con `fotoCargada`, y una `PENDIENTE_PAGO` sin ellos.

    _(crítico)_ (RNF-05, Ley 29733, D-05, DR-9, DR-14; criterio 32; respuesta R3, ronda 1)
59. **Límites por IP con la clave de conexión (amplía el 33 y el 49).** La función pura `claveDeConexion(ip)` agrupa las
    direcciones:
    - una IPv4 da la misma dirección (`203.0.113.1`);
    - una IPv6 mapeada a IPv4, en cualquier forma escrita (`::ffff:203.0.113.1`, `::FFFF:203.0.113.1`,
      `0:0:0:0:0:ffff:203.0.113.1`, `::ffff:cb00:7101`), da la IPv4 (`203.0.113.1`);
    - cualquier otra IPv6 da su bloque /64 en forma canónica (`2001:db8:1:2::/64`): `2001:DB8:1:2::1`,
      `2001:0db8:0001:0002:ffff:ffff:ffff:ffff` y `2001:db8:1:2:0:0:0:abc` dan la misma clave; `2001:db8:1:3::1`, otra;
      la zona de una IPv6 de enlace local se ignora (`fe80::1%eth0` da `fe80::/64`); `::1` da `::/64`, distinta de
      cualquier IPv4;
    - un texto que no es una IP (o la IP vacía, cuando Express no la tiene) da el mismo texto, sin lanzar errores.

    Todas las reglas del criterio 33 (las dos lecturas, también con `HEAD`; la cotización; el envío; la consulta; en la
    005b, la foto) cuentan con `claveDeConexion(req.ip)`. El límite del ingreso (002) no cambia (pregunta R6). Pruebas
    de integración (con una app de prueba que confía en el proxy de `loopback`, para fijar la IP de cada petición con
    `X-Forwarded-For`; la app real no cambia, DT-9), cada una con un almacén limpio:
    - a) 60 lecturas, cada una desde una dirección distinta de `2001:db8:1:2::/64`: la 61, desde otra dirección del mismo
      bloque, responde 429; desde `2001:db8:1:3::1`, 200;
    - b) `203.0.113.1` y `203.0.113.2` tienen contadores separados; `203.0.113.1` y `::ffff:203.0.113.1` comparten el
      suyo (30 lecturas desde cada forma: la 61 responde 429);
    - c) lo mismo con la cotización (30 por minuto), el envío (10 por hora, con cuerpos inválidos, que también cuentan) y
      la consulta (10 por minuto), cada uno con direcciones distintas del mismo /64.

    _(crítico)_ (DR-8, DR-15, nota O2 de 001; criterios 33 y 49; respuesta R4, ronda 1)
60. **Reservas sin pagar por conexión con la clave de conexión (amplía el 25).** El límite de 5 solicitudes activas
    cuenta las creadas desde la misma clave de conexión (criterio 59) en la academia, y el bloqueo consultivo de la IP
    del envío usa esa clave (`'inscripcion-ip:' || academia || ':' || clave`). `ip_origen` sigue guardando la dirección
    exacta (como la normaliza `ipParaAuditoria`), no el bloque. Pruebas:
    - a) 5 solicitudes activas desde cinco direcciones distintas de `2001:db8:1:2::/64`: un envío desde una sexta
      dirección del mismo bloque responde 409 `LIMITE_DE_RESERVAS_PENDIENTES` sin escribir; desde `2001:db8:1:3::1`, 201;
    - b) 5 activas desde `203.0.113.7`: desde `::ffff:203.0.113.7`, 409; desde `203.0.113.8`, 201;
    - c) las filas escritas como dueño cuentan igual: una solicitud activa con `ip_origen` `2001:db8:1:2::abcd` cuenta
      para un envío desde `2001:db8:1:2::1`;
    - d) 4 activas en el bloque y dos envíos simultáneos desde dos direcciones distintas del mismo /64 (DNI distintos):
      exactamente uno responde 201 y el otro 409 `LIMITE_DE_RESERVAS_PENDIENTES`; nunca 500 ni `40P01`;
    - e) vencidas, canceladas y de otra academia siguen sin contar.

    _(crítico)_ (DR-8, DR-15, riesgo de 11.4; criterio 25; respuesta R4, ronda 1)

## Casos límite

- **La clase de 19:00 a 20:00 de hoy:** a las 18:59:59 de Lima cuenta como clase restante; a las 19:00:00 ya no
  (criterio 8). El servidor en otra zona horaria no cambia el resultado.
- **Envío el último día del mes después de las 20:00:** no quedan clases; 409 `SIN_CLASES_EN_EL_MES` (criterios 11 y 15
  c). La inscripción del mes siguiente no existe en esta historia (pregunta N3).
- **Cotización el 30 a las 23:59 y envío el 1 a las 00:00:** 409 `MES_CAMBIO`; la web vuelve a cotizar (criterio 19).
- **Inscripción el día 1 en un mes con menos clases que el plan** (por ejemplo, 11 sesiones de lunes, miércoles y
  viernes para un plan de 12): con la regla literal de HU-34 paga 11/12 del precio (pregunta N2).
- **Precio con céntimos y mes completo:** S/ 120.50 se cobra S/ 121, porque el total siempre se redondea hacia arriba al
  sol entero (D-03, criterio 9).
- **Cumpleaños número 18 hoy:** ya es mayor de edad; enviar apoderado responde 400 (criterio 13).
- **Nacido el 29 de febrero:** cumple 18 el 1 de marzo de los años no bisiestos (`date-fns`, `differenceInYears` en
  Lima; criterio 13).
- **Clase llena mientras elige:** 409 `SIN_CUPO` con los ids; la web refresca y pide otra (criterio 17).
- **Reserva que vence mientras el cliente mira el seguimiento:** pasa a `VENCIDA` en la siguiente consulta; la subida de
  foto responde 409 `SOLICITUD_NO_EDITABLE`.
- **Cliente con reserva vencida que vuelve a inscribirse:** se acepta y reemplaza sus datos (criterio 21 b, N6).
- **Persona que era menor con apoderado y vuelve como mayor:** se borra su apoderado (criterio 21 b; único `DELETE`).
- **DNI del personal de la academia:** 409 `DNI_YA_REGISTRADO`, como un alumno (criterio 21 a; la 007 no podría crear su
  cuenta, porque el DNI es único en `usuarios`).
- **Aforo bajado con confirmación por debajo de la ocupación:** la clase deja de aparecer en el formulario y nadie pierde
  su lugar (criterios 6 y 41).
- **Clase con entrenador inactivo (DR-6 de 004):** se sigue ofreciendo; el público no ve el entrenador.
- **Plan desactivado o vencido con reservas:** las reservas siguen (DR-2 de 004: no afecta a lo ya elegido); el plan deja
  de ofrecerse.
- **Academia suspendida:** todas las rutas públicas responden 403 `ACADEMIA_SUSPENDIDA`, también la consulta de
  seguimiento.
- **Código escrito con minúsculas o con espacios alrededor:** se encuentra (criterio 30). Con O en lugar de 0: no se
  corrige; no se encuentra.
- **Token con un carácter de más, recortado o en otra codificación:** 404 (criterio 31).
- **Foto con orientación EXIF de 90°:** se guarda girada correctamente y sin el EXIF (criterio 35).
- **Foto de 5 MB exactos:** se acepta; un byte más, 413 (criterio 34).
- **Dos pestañas con el mismo formulario:** la misma `claveIdempotencia` solo si es la misma pestaña; dos pestañas
  distintas chocan por DNI (criterio 22).
- **Cuerpo con `academiaId`, `estado`, `monto` o `reservaVenceEn`:** 400 por campos de más (esquemas estrictos).
- **Matrícula de un mes pasado `RESERVADA` y sin pagar:** no ocupa cupo en el mes en curso (la ocupación es por mes).
- **Plan de S/ 99999.99 a mes completo:** la cotización da S/ 100000.00 y el envío con ese monto se acepta (criterio 50).
- **`HEAD` en lugar de `GET`:** cuenta en el mismo límite de lectura (criterio 49).
- **Proveedor de correo colgado o que falla con el destinatario en el error:** el 201 llega igual y el registro solo
  dice el tipo del error (criterios 51 y 52).
- **Petición a la API desde la página de seguimiento con `Referer`:** el registro técnico no guarda la dirección con el
  token (criterio 53).
- **Envío el 30 de noviembre a las 10:00 con la clase de las 18:00 por delante:** la reserva vence a las 23:59:59.999 del
  30, no el 1 de diciembre a las 10:00; el 1 de diciembre la solicitud se ve `VENCIDA` y la persona puede volver a
  inscribirse para diciembre con su DNI (criterios 54 y 55).
- **Envío a las 00:00 del último día del mes:** las 24 horas llegarían al día siguiente; vence a las 23:59:59.999 de ese
  mismo día (criterio 54 d).
- **Menor con el mismo correo que su apoderado (con mayúsculas o espacios distintos):** un solo correo (criterio 57).
- **Menor sin correo propio y con correo del apoderado:** el enlace llega solo al apoderado (criterio 57).
- **Alguien vuelve a usar el DNI de un cliente con la solicitud vencida:** se acepta (21 b, DR-14); el enlace anterior
  solo muestra el estado y los datos de su propia solicitud, sin nombre (criterio 58).
- **Una familia con IPv6:** todos sus equipos del mismo /64 comparten los límites, como una casa con IPv4 detrás de un
  router (criterios 59 y 60).
- **IPv4 que Express entrega como `::ffff:a.b.c.d`:** cuenta igual que `a.b.c.d` (criterio 59).

## Reglas de negocio aplicables

- **HU-01 y RN-20:** datos personales, ficha médica, apoderado si es menor, DNI de 8 dígitos no registrado,
  consentimiento de datos y deslinde obligatorios.
- **HU-02:** solo clases del nivel con cupo; tantos días como la frecuencia del plan; cupos restantes visibles; aviso si
  se llena mientras se elige.
- **RN-07, DR-2 de 004:** el plan se ofrece si está activo y vigente hoy; sus días, franjas y niveles limitan la elección.
- **RN-08:** el alumno elige días y horario al inscribirse; después no puede cambiarlos (no hay ruta para hacerlo; el
  cambio por la secretaria es de la 010).
- **RN-11 y DR-5 de 004:** nunca más inscritos que el aforo; bajar el aforo con confirmación; no desactivar con inscritos.
- **RN-25, HU-34 y D-03:** proporcional por clases restantes con tope; exacto; redondeo hacia arriba una vez al final; el
  precio ya incluye IGV.
- **RN-27:** no hay matrícula de inscripción; solo la mensualidad.
- **RN-28 y sección 4.1:** el cupo queda reservado mientras el pago está pendiente; al rechazarse, se libera (007). Antes
  del pago, la reserva vence (pregunta N1).
- **RN-01 y HU-04:** la persona es cliente hasta que su primer pago se confirme; usuario y carnet, en la 007 y la 008.
- **D-05:** código corto y enlace secreto; consulta con el enlace o con el código y el DNI.
- **D-07:** consentimientos con tipo, fecha, IP y versión; solicitud con código y token.
- **D-15:** el nivel decide las clases.
- **D-20 y D-24:** foto opcional en el formulario.
- **D-19 y D-21:** correo simulado y archivos detrás de interfaces.
- **D-23, D-27, D-28 y D-29:** todo por academia, nombre corto en la dirección, DNI único por academia, el Superadmin no
  ve nada.
- **RN-21 y RNF-05:** datos médicos y de menores con acceso restringido y consentimiento expreso.
- **RN-22 y RNF-06:** auditoría de reservas y cancelaciones (cupo) y de cambios de aforo.
- **Reglas para las historias siguientes de `docs/arquitectura.md`:** `bloquearActorVigente` primero en las rutas del
  panel; `bloquearClasesParaCupo` antes de contar o escribir; `await` en cada paso; varias filas con una sola sentencia;
  montos en `numeric` y `Decimal`; fechas en America/Lima; sin caché en los servicios; errores con `errorParaRegistro`;
  409 por el nombre de la restricción.

## Contrato

### Rutas

Mismas reglas que 001 a 004: `Cache-Control: no-store` en toda respuesta, cuerpos JSON con esquemas estrictos y las
reglas de cuerpos de 001 (salvo la foto, que es binaria). En las rutas públicas, el orden es límite por IP (criterio 33)
→ academia (404 o 403) → cuerpo (400) → operación. En las del panel, el de 002 (sesión → academia activa → cambio
obligatorio → permiso → cuerpo → operación).

| Método y ruta | Sesión y permiso | Entrada | Éxito | Errores |
| --- | --- | --- | --- | --- |
| `GET /api/a/{nombreCorto}` | pública | — | 200 `AcademiaPublica` (con `telefono`) | 404, 403, 429 |
| `GET /api/a/{nombreCorto}/inscripcion` | pública | — | 200 `RespuestaFormularioInscripcion` | 404, 403, 429 |
| `POST /api/a/{nombreCorto}/inscripcion/cotizacion` | pública | `cotizarInscripcionSchema` | 200 `RespuestaCotizacion` | 400, 404, 403, 409 `PLAN_NO_DISPONIBLE`, `SELECCION_NO_VALIDA`, `SIN_CLASES_EN_EL_MES`, 429 |
| `POST /api/a/{nombreCorto}/inscripcion` | pública | `enviarInscripcionSchema` | 201 `RespuestaInscripcionCreada` | 400, 404, 403, 409 (ver orden), 429 |
| `POST /api/a/{nombreCorto}/solicitudes/consulta` | pública | `consultarSolicitudSchema` | 200 `RespuestaConsultaSolicitud` | 400, 404 `SOLICITUD_NO_ENCONTRADA`, 403, 429 |
| **[005b]** `PUT /api/a/{nombreCorto}/solicitudes/foto` | pública, cabecera `X-Token-Solicitud` | JPEG o PNG, hasta 5 MB | 204 | 400 `IMAGEN_NO_VALIDA`, 404, 403, 409 `SOLICITUD_NO_EDITABLE`, 413, 429 |
| **[005b]** `GET /api/solicitudes?estado=` | `REGISTRAR_INSCRIPCION_Y_COBRO` | — | 200 `RespuestaListaSolicitudes` | 400, 401, 403 |
| **[005b]** `POST /api/solicitudes/{id}/cancelar` | `REGISTRAR_INSCRIPCION_Y_COBRO` | `cancelarSolicitudSchema` | 200 `RespuestaSolicitudPanel` | 400, 401, 403, 404, 409 `SOLICITUD_NO_CANCELABLE` |
| **[005b]** `GET /api/clases/ocupacion` | `CONFIGURAR_PLANES_HORARIOS_AFORO` | — | 200 `RespuestaOcupacion` | 401, 403 |
| `PATCH /api/clases/{id}` (de 004) | `CONFIGURAR_PLANES_HORARIOS_AFORO` | `actualizarClaseSchema` + `confirmarAforoMenor` | 200 | los de 004 + 409 `AFORO_MENOR_QUE_INSCRITOS`, `CLASE_CON_INSCRITOS` |

**Orden de los 409 del envío** (después del 400 del esquema y de los 400 de los criterios 13 y 14):
`SOLICITUD_YA_REGISTRADA` → `TEXTOS_ACTUALIZADOS` → `MES_CAMBIO` → `PLAN_NO_DISPONIBLE` → `DNI_YA_REGISTRADO` →
`LIMITE_DE_RESERVAS_PENDIENTES` → `SELECCION_NO_VALIDA` → `SIN_CLASES_EN_EL_MES` → `SIN_CUPO` → `MONTO_CAMBIO`. Desde
`SELECCION_NO_VALIDA`, se deciden con las clases ya bloqueadas (sigue el orden de bloqueos de "Reglas para las historias
siguientes"). La cotización usa el mismo orden para los códigos que comparte. `SOLICITUD_NO_CANCELABLE` (409) es para una solicitud que ya no está `PENDIENTE_PAGO` ni `CANCELADA` (desde la
007).

Las rutas marcadas **[005b]** llegan en el siguiente PR; la 005a construye las demás, incluidos los dos 409 nuevos del
`PATCH /api/clases/{id}`. De los códigos de error nuevos, `SOLICITUD_NO_EDITABLE`, `SOLICITUD_NO_CANCELABLE` e
`IMAGEN_NO_VALIDA` son de la 005b; de la auditoría, `SOLICITUD_INSCRIPCION_CANCELADA`; de los esquemas compartidos,
`solicitudPanelSchema`, `respuestaListaSolicitudesSchema`, `cancelarSolicitudSchema`, `filtroEstadoSolicitudesSchema` y
`respuestaOcupacionSchema`; de las interfaces del backend, `AlmacenArchivos`.

El `{id}` de `POST /api/solicitudes/{id}/cancelar` lo valida el servicio después de `bloquearActorVigente`, como AT-2 de
004: un id que no es UUID responde el mismo 404 que uno inexistente o de otra academia.

### Esquemas compartidos (`packages/contratos/src/`)

- `inscripcion.ts`: `enviarInscripcionSchema` (estricto en todos los niveles):
  `{ claveIdempotencia, alumno: { nombres, apellidos, dni, fechaNacimiento, telefono, correo?, direccion?,
  gradoColegio?, nivel }, fichaMedica: { tipoSangre, enfermedades?, alergias?, medicamentos?, seguro?,
  contactoEmergencia: { nombre, telefono } }, apoderado?: { nombres, apellidos, dni, telefono, parentesco, correo? },
  inscripcion: { planId, claseIds, mes, montoMostrado }, consentimientos: { version, datosPersonales, deslinde, imagen? } }`
  (obligatorios y opcionales provisionales, N5); `cotizarInscripcionSchema` (`{ planId, nivel, claseIds }`);
  `cotizacionSchema`; `respuestaFormularioInscripcionSchema`; `respuestaInscripcionCreadaSchema`; `TIPOS_SANGRE`,
  `GRADOS_COLEGIO`, `PARENTESCOS`, `telefonoCelularSchema` y `esMenorDeEdad(fechaNacimiento, hoy)` (función pura que
  usan la API y la web). Reutiliza `dniSchema`, `nivelNatacionSchema`, `fechaSchema` y `textoVisibleSchema`;
  `montoMostrado` usa `montoCotizadoSchema` (criterio 50, ataque ronda 1).
- `dinero.ts`: suma `MONTO_COTIZADO_MAXIMO = '100000.00'` y `montoCotizadoSchema` (criterio 50); `montoSchema` y
  `MONTO_MAXIMO` no cambian.
- `consentimientos.ts`: `VERSION_CONSENTIMIENTOS`, `TIPOS_CONSENTIMIENTO` (`DATOS_PERSONALES`, `DESLINDE`, `IMAGEN`) y
  `textosConsentimiento(nombreAcademia, { menor })`.
- `solicitudes.ts`: `codigoSolicitudSchema` (recorta y pasa a mayúsculas; `^AQ-[0-9A-HJKMNP-TV-Z]{6}$`),
  `tokenSeguimientoSchema` (`^[A-Za-z0-9_-]{43}$`), `consultarSolicitudSchema` (unión estricta: `{ token }` o
  `{ codigo, dni }`, cada uno un texto de hasta 100 caracteres; el formato del token, del código y del DNI lo comprueba
  el servicio y, si no se cumple, responde el 404 del criterio 31, no un 400), `estadoSolicitudSchema`, `vistaSolicitudSchema` (criterio 32; desde la respuesta R3, unión estricta de la vista completa en `PENDIENTE_PAGO` y la reducida en `VENCIDA` y `CANCELADA`, criterio 58), `respuestaConsultaSolicitudSchema`,
  `solicitudPanelSchema`, `respuestaListaSolicitudesSchema`, `cancelarSolicitudSchema` y `filtroEstadoSolicitudesSchema`.
- `academias.ts`: `academiaPublicaSchema` suma `telefono` (texto o `null`).
- `clases.ts`: `actualizarClaseSchema` suma `confirmarAforoMenor` (booleano opcional; no cuenta como "un campo" para el
  "al menos uno"); `respuestaOcupacionSchema`.

### Interfaces del backend (para las historias siguientes)

```ts
// backend/src/modulos/matriculas/ocupacion.ts (sin Nest, reexportada en matriculas/index.ts).
// Cuenta, sin bloquear, la ocupación de las clases en el mes; quien llama ya bloqueó las clases con bloquearClasesParaCupo.
function contarOcupacion(tx: TransaccionAcademia, claseIds: readonly string[], mes: { anio: number; mes: number },
  ahora: Date): Promise<Map<string, number>>;
// Inscritos para DR-5: la mayor ocupación del mes en curso y de los siguientes.
function contarInscritos(tx: TransaccionAcademia, claseIds: readonly string[], ahora: Date): Promise<Map<string, number>>;

// backend/src/modulos/matriculas/dominio/cobro.ts (puras).
function clasesRestantes(clases: readonly { diaSemana: DiaSemana; horaInicio: Bloque }[], ahora: Date): number;
function montoProporcional(precio: Decimal, clasesPorMes: number, clasesTotales: number): Decimal; // entero
type Racional = { numerador: bigint; denominador: bigint }; // en soles (P1)
type Descuento = { tipo: 'PORCENTAJE' | 'MONTO_FIJO'; valor: Decimal }; // P1
function calcularTotal(entrada: { base: Racional; montoAjustado?: Decimal; descuento?: Descuento }): Decimal; // entero

// backend/src/modulos/matriculas/dominio/reserva.ts (puras; respuesta R1, criterio 54).
function finDelMesEnLima(ahora: Date): Date; // 23:59:59.999 del último día del mes de "ahora" en America/Lima
function vencimientoDeReserva(ahora: Date): Date; // min(ahora + 24 h, finDelMesEnLima(ahora))

// backend/src/comun/http/conexion.ts (pura; respuesta R4, criterio 59).
function claveDeConexion(ip: string): string; // IPv4 exacta (también la mapeada); otra IPv6, su /64 canónico

// backend/src/infraestructura/almacen-archivos/
interface AlmacenArchivos {
  guardar(academiaId: string, clave: string, contenido: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<void>;
  leer(academiaId: string, clave: string): Promise<Buffer>;
  borrar(academiaId: string, clave: string): Promise<void>;
}
// backend/src/infraestructura/correo/ (index.ts exporta la interfaz y el token de inyección ENVIADOR_CORREO; P7)
interface EnviadorCorreo {
  enviar(mensaje: { academiaId: string; para: string; plantilla: 'SEGUIMIENTO_SOLICITUD'; datos: Record<string, string> }): Promise<void>;
}
```

### Auditoría

- `SOLICITUD_INSCRIPCION_CREADA` (actor `PUBLICO`, criterio 26) y `SOLICITUD_INSCRIPCION_CANCELADA` (actor `USUARIO`,
  criterio 39), entidad `solicitud_inscripcion`.
- `CLASE_ACTUALIZADA` (de 004) suma `inscritos` y `confirmacion` cuando se confirma un aforo menor (criterio 41).

### Códigos de error nuevos

`PLAN_NO_DISPONIBLE`, `SELECCION_NO_VALIDA`, `SIN_CLASES_EN_EL_MES`, `SIN_CUPO`, `MES_CAMBIO`, `MONTO_CAMBIO`,
`TEXTOS_ACTUALIZADOS`, `DNI_YA_REGISTRADO`, `SOLICITUD_YA_REGISTRADA`, `LIMITE_DE_RESERVAS_PENDIENTES`,
`SOLICITUD_NO_EDITABLE`, `SOLICITUD_NO_CANCELABLE`, `AFORO_MENOR_QUE_INSCRITOS` y `CLASE_CON_INSCRITOS` (409);
`SOLICITUD_NO_ENCONTRADA` (404); `IMAGEN_NO_VALIDA` (400). Se reutilizan `SOLICITUD_INVALIDA`, `NO_ENCONTRADO`,
`CARGA_EXCESIVA`, `DEMASIADAS_SOLICITUDES` y los de academia, sesión y permisos.

### Eventos

Ninguno. El correo de seguimiento es un efecto después de confirmar (criterio 27), no un evento.

## Cambios al modelo de datos

Una migración `<marca>_inscripcion_publica`. Ajusta las entidades `ALUMNO`, `APODERADO`, `FICHA_MEDICA`, `MATRICULA` y
`MATRICULA_CLASE` de la sección 9.1 y suma las de D-07 (consentimientos y solicitud). Todas con `academia_id`
(D-23), `creado_en` y `actualizado_en` donde se actualizan, RLS activada y forzada con la forma del criterio 132 de 001.

- **Tipos:** `estado_alumno` (`CLIENTE`, `ALUMNO_ACTIVO`, `ALUMNO_VENCIDO`, `INACTIVO`; sección 8.8; esta historia solo
  escribe `CLIENTE`); `estado_solicitud` (`PENDIENTE_PAGO`, `VENCIDA`, `CANCELADA`; la 007 suma los suyos);
  `estado_matricula` (`RESERVADA`, `VIGENTE`, `FINALIZADA`, `CANCELADA`; sección 8.8); `tipo_consentimiento`
  (`DATOS_PERSONALES`, `DESLINDE`, `IMAGEN`; D-07, sin WhatsApp por D-08); `otorgante_consentimiento` (`TITULAR`,
  `APODERADO`); `tipo_sangre`, `grado_colegio` y `parentesco` (listas de N5). `tipo_actor` suma `PUBLICO` (pregunta T2).
- **`alumnos`:** `id`, `academia_id`, `dni text` (`^[0-9]{8}$`), `nombres`, `apellidos`, `fecha_nacimiento date`
  (finita), `telefono`, `correo null`, `direccion null`, `grado_colegio null`, `nivel nivel_natacion`,
  `foto_clave text null`, `estado estado_alumno default 'CLIENTE'`, `usuario_id uuid null` (la 007 la llena; llave
  compuesta a `usuarios`), `creado_en`, `actualizado_en`. `UNIQUE (academia_id, dni)` (D-28), `UNIQUE (academia_id, id)`.
  Sin `sexo` ni `colegio` (N5) ni `qr_token` (008).
- **`apoderados`:** PK `(academia_id, alumno_id)` (P10), llave compuesta `(academia_id, alumno_id) → alumnos
  (academia_id, id)`, `nombres`, `apellidos`, `dni`, `telefono`, `parentesco`, `correo null`, fechas. Uno por alumno
  (HU-01).
- **`fichas_medicas`:** PK `(academia_id, alumno_id)` (P10) y la misma llave compuesta, `tipo_sangre`, `enfermedades null`,
  `alergias null`, `medicamentos null`, `seguro null`, `contacto_emergencia_nombre`, `contacto_emergencia_telefono`,
  fechas. Sin `observaciones` en esta historia (lo agrega quien la use, 012).
- **`consentimientos`:** `id`, `academia_id`, `alumno_id` (llave compuesta), `solicitud_id` (llave compuesta), `tipo`,
  `version text` (no vacía), `aceptado_en timestamptz`, `ip inet null`, `otorgado_por`, y el valor para `IMAGEN`
  (`aceptado boolean`; para los otros dos siempre `true`). `UNIQUE (academia_id, id)`, como exige el catálogo de 001
  (criterios 12 y 131) aunque ninguna tabla la referencie todavía (P5). Solo `INSERT`: es evidencia (D-07).
- **`solicitudes_inscripcion`:** `id`, `academia_id`, `alumno_id` (llave compuesta), `codigo text` (formato del criterio
  24), `token_hash bytea` (32 bytes), `clave_idempotencia uuid`, `estado estado_solicitud default 'PENDIENTE_PAGO'`,
  `ip_origen inet null`, `creado_en`, `actualizado_en`. `UNIQUE (academia_id, codigo)`, `UNIQUE (academia_id,
  token_hash)`, `UNIQUE (academia_id, clave_idempotencia)`, índice único parcial `(academia_id, alumno_id) WHERE estado =
  'PENDIENTE_PAGO'`, índice `(academia_id, ip_origen, estado)` para el criterio 25.
- **`matriculas`:** `id`, `academia_id`, `alumno_id` y `plan_id` (llaves compuestas), `solicitud_id null` (llave
  compuesta; las renovaciones de la 010 no tienen), `anio smallint`, `mes smallint` (1 a 12), `fecha_inicio`,
  `fecha_fin`, `clases_totales smallint`, `clases_usadas smallint default 0`, `es_proporcional boolean`,
  `precio_plan numeric(10,2)`, `clases_por_mes_plan smallint`, `monto_calculado numeric(10,2)`, `monto_ajustado
  numeric(10,2) null` y `motivo_ajuste text null` (los usa la 007), `estado estado_matricula`, `reserva_vence_en
  timestamptz null`, fechas. `CHECK` del criterio 4 c. Índice único parcial `(academia_id, alumno_id, anio, mes) WHERE
  estado IN ('RESERVADA', 'VIGENTE')` (criterio 4 d). Índice `(academia_id, anio, mes, estado)`.
- **`matricula_clases`:** `academia_id`, `matricula_id` y `clase_id` (llaves compuestas), PK `(academia_id,
  matricula_id, clase_id)` (P10), índice `(academia_id, clase_id)` para contar la ocupación.
- **Llaves primarias con `academia_id` (P10, decisión del orquestador ya aplicada en la migración):** las tres PK de
  arriba llevan `academia_id` como primera columna para cumplir los criterios 126, 131 y 142 de 001 (toda llave
  primaria o única de una tabla con `academia_id` la incluye, salvo la PK formada solo por `id`). Las escrituras con
  `ON CONFLICT` sobre esas tablas usan `(academia_id, alumno_id)`.
- **Privilegios de `aquagestion_app`** (criterio 2): `SELECT` e `INSERT` en las siete; `UPDATE` de `alumnos` (`nombres`,
  `apellidos`, `fecha_nacimiento`, `telefono`, `correo`, `direccion`, `grado_colegio`, `nivel`, `foto_clave`,
  `actualizado_en`), `apoderados` (todas menos `alumno_id`, `academia_id` y `creado_en`), `fichas_medicas` (todas menos
  `alumno_id`, `academia_id` y `creado_en`; P4), `solicitudes_inscripcion` (`estado`, `actualizado_en`) y `matriculas` (`estado`, `reserva_vence_en`,
  `actualizado_en`); `DELETE` solo en `apoderados` (con su política). La 007 y la 010 amplían lo que necesiten (por
  ejemplo `alumnos.estado` y `usuario_id`) en sus propias migraciones.
- `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` se amplían en el mismo cambio.
- **Respuesta R1, ronda 1 (criterio 56):** una migración nueva `<marca>_reserva_dentro_del_mes` suma a `matriculas` el
  `CHECK matriculas_reserva_dentro_del_mes`: `reserva_vence_en IS NULL OR reserva_vence_en < (make_date(anio, mes, 1) +
  interval '1 month')::timestamp AT TIME ZONE 'America/Lima'`, con el mismo cuidado de `anio` y `mes` fuera de rango que
  `matriculas_fechas_del_mes`. Sin tablas, columnas, privilegios ni datos nuevos.

## Fuera de alcance

- **Pagos:** efectivo, Yape, transferencia, comprobante, número de operación, bandeja de verificación, rechazo y nuevo
  comprobante desde el enlace (D-05), y el paso de `RESERVADA` a `VIGENTE` y de cliente a alumno con usuario: 007.
  También el ajuste del monto por el administrador (HU-34) y el ticket.
- **Caja:** 006.
- **Carnet, QR y ver la foto:** 008. En esta historia nadie lee la foto guardada.
- **Ficha del alumno para el personal y datos médicos en pantalla:** 007 (lo que necesite la secretaria) y 012.
- **Códigos de descuento:** 015 (el cálculo de D-03 ya los admite, criterio 10).
- **Inscripción para el mes siguiente y prioridad de renovación (D-06):** 010 (pregunta N3).
- **Cambio de horario por la secretaria (HU-03, RN-08) y mover inscritos de una clase:** 010.
- **Cierre de mes, tarea programada y clases no usadas (RN-23):** 010. Esta historia no tiene tareas programadas.
- **Días de cierre (RN-33):** 017; el conteo de clases restantes no los descuenta.
- **Que el cliente cancele su propia solicitud desde el enlace:** no (pregunta N9).
- **Carné de extranjería u otros documentos:** HU-01 pide DNI de 8 dígitos.
- **Captcha o verificación del correo o del teléfono:** no; los límites por IP del criterio 33 y el 25 son la defensa.
- **Borrado o retención de datos de solicitudes vencidas o canceladas (Ley 29733):** política futura (ver "Riesgos").
- **Proveedor real de correo y de archivos:** con el hosting (D-19, D-21).

## Impacto en especificaciones anteriores

- **001, criterio 58 (`AcademiaPublica`):** suma `telefono`. La prueba protegida que compara la forma exacta la actualiza
  el test-writer en el commit "Pruebas protegidas (005)", solo para sumar el campo; sigue sin id, estado ni motivo. Lo
  mismo con `academiaPublicaSchema` en sus pruebas.
- **001, `tipo_actor` y `EntradaAuditoria`:** suman `PUBLICO` (T2). Si una prueba protegida de 001 compara la lista exacta
  de valores, se actualiza igual, solo para sumar.
- **001, criterio 2 y `PRIVILEGIOS_APP` (criterio 102), `TABLAS_DESPUES_DE_MIGRAR`:** suman lo de las siete tablas
  (como en la 004).
- **[005b] 001, criterio 127 (dependencias del backend):** `sharp` se suma a `DEPENDENCIAS_BACKEND_PERMITIDAS` (D-25; T6).
- **[005b] 001, lector de cuerpos (criterio 74):** la ruta de la foto queda fuera de los tres middlewares de JSON (como
  `DELETE /api/sesion`), con su propio lector binario de hasta 5 MB y sin descompresión. Ninguna otra ruta cambia.
- **001, nota O2 y 002, límites:** se cierran para `GET /api/a/{nombreCorto}` con el criterio 33. El límite del ingreso
  (002) no cambia.
- **003, DR-4:** el teléfono se publica en las páginas públicas (criterios 5 y 45). `GET /api/mi-academia` no cambia.
- **004, criterio 21 y `actualizarClaseSchema`:** suma `confirmarAforoMenor` y los dos 409 de DR-5 (criterios 41 y 42).
  Si una prueba protegida de 004 comprueba que un campo desconocido responde 400 usando ese mismo nombre, se ajusta en el
  commit de pruebas protegidas de 005. `claseSchema` y `GET /api/clases` no cambian.
- **004, criterio 22:** sigue igual; DR-5 cuenta los inscritos después de ese bloqueo.
- **002, matriz de permisos (criterio 26):** no cambia (24 filas): se usan `REGISTRAR_INSCRIPCION_Y_COBRO` y
  `CONFIGURAR_PLANES_HORARIOS_AFORO`.
- **Web de 002:** la página de ingreso muestra el teléfono (criterio 45, 005a); el inicio del panel suma dos opciones
  (criterio 46, 005b).
- **`docs/arquitectura.md`:** secciones nuevas (criterio 48).
- **Registro técnico (ronda 1, criterio 53):** `RUTAS_REDACTADAS` suma `req.headers.referer` para toda la API. La prueba
  no protegida `backend/src/infraestructura/registro/opciones-registro.test.ts`, que fija su largo en 3, se ajusta en el
  mismo cambio de implementación (no es protegida). Ninguna prueba protegida de 001 a 004 fija esa lista.
- **004, `montoSchema` (ronda 1, criterio 50):** no cambia; el monto cotizado usa un esquema aparte.
- **004, criterio 30 y semilla (ronda 1, criterio 47):** la semilla suma clases de ejemplo en `delfines` sin romper la
  prueba de la semilla de 004 (bloques con dos clases de niveles y entrenadores distintos; la clase Básico del lunes
  sigue siendo una sola).
- **Prueba protegida de la 005a que cambia (respuesta R3, criterio 58):** en
  `backend/test/integracion/inscripciones/seguimiento.test.ts`, la prueba "criterio 32: una solicitud VENCIDA o
  CANCELADA muestra lo mismo sin reservaVenceEn" espera hoy las claves de la vista completa menos `reservaVenceEn` y
  `nombres: 'Valeria'`. La ajusta el test-writer en el commit de pruebas protegidas de las respuestas de la ronda 1, solo
  para exigir la vista reducida (sin `nombres` ni `fotoCargada`): la prueba queda más estricta, no más débil. Lo
  aprueba el orquestador antes del commit. Ninguna otra prueba protegida de la 005a cambia: las de los criterios 16, 20
  y 32 usan `AHORA_005` (11 de noviembre), donde las 24 horas no llegan al fin del mes, y ninguna utilidad de pruebas
  escribe una reserva que cruce el mes (el `CHECK` del criterio 56 las rechazaría; si el tester encuentra una, decide el
  orquestador).
- **Pruebas no protegidas y web que cambian (respuestas de la ronda 1):** `packages/contratos/src/solicitudes.test.ts`
  (acepta hoy una `VENCIDA` con `nombres`) y la vista de la página de seguimiento, que saluda con el nombre
  (criterio 44), se ajustan en el mismo cambio de implementación.
- **002, límite del ingreso:** no cambia; sigue contando por dirección exacta (pregunta R6).

## Reglas para las historias siguientes

Para documentar en `docs/arquitectura.md` (criterio 48):

- **Orden de bloqueos con alumnos y solicitudes.** `usuarios` (actor, con `bloquearActorVigente`) → bloqueos
  consultivos del envío público, primero el de la conexión de origen (`'inscripcion-ip:' || academia || ':' ||
  claveDeConexion(ip)`, criterio 60) y después
  el del DNI (`'inscripcion-dni:' || academia || ':' || dni`), con `pg_advisory_xact_lock(hashtextextended(…, 0))` →
  filas de `alumnos`, `solicitudes_inscripcion` y `matriculas` (`FOR UPDATE`) → `clases` (`bloquearClasesParaCupo`, una
  llamada) → escrituras. Nunca al revés. Las lecturas de `usuarios` sin bloqueo (como la del criterio 21 a) no cuentan.
- **Ocupación.** Se cuenta con `contarOcupacion` o `contarInscritos` después de `bloquearClasesParaCupo` y con "ahora"
  de `RELOJ`. Una matrícula ocupa cupo si está `VIGENTE`, o `RESERVADA` con `reserva_vence_en` nula o posterior a
  "ahora".
- **Reservas y fin de mes (DR-12).** Una reserva sin pago vence con `vencimientoDeReserva` (24 horas o el fin del mes en
  Lima, lo que ocurra primero) y la base no acepta una `reserva_vence_en` posterior al fin del mes de su matrícula
  (criterio 56). Nunca queda una reserva vigente de un mes ya cerrado.
- **Para la 007:** al registrar un comprobante, la matrícula queda `RESERVADA` con `reserva_vence_en = NULL` (sin límite,
  RN-28); si la reserva ya había vencido, antes vuelve a pedir cupo (como D-05 tras un rechazo). Con DR-12 ("nunca queda
  una reserva vigente de un mes ya cerrado"), la 007 debe decidir con el responsable qué pasa con un comprobante que
  sigue en verificación cuando termina el mes de su matrícula (pregunta anotada en `specs/backlog.md`). Al rechazar, la
  matrícula pasa a `CANCELADA` y el cupo se libera. Al confirmar, `VIGENTE`, el alumno pasa de `CLIENTE` a
  `ALUMNO_ACTIVO` y se crea su usuario (HU-04). El total sale de `calcularTotal` con lo guardado en la matrícula
  (`precio_plan`, `clases_por_mes_plan`, `clases_totales`), nunca del plan (HU-19).
- **[005b] Archivos.** Toda historia que guarda archivos (comprobantes 007, multimedia 014, certificados) usa `AlmacenArchivos`
  con claves generadas por el servidor bajo `academias/{academiaId}/…`, procesa y guarda antes de la transacción y borra
  lo reemplazado después de confirmar (criterio 37). Las imágenes subidas por el público se recodifican sin metadatos
  (criterio 35).
- **Tokens públicos.** Un token que da acceso sin sesión se genera con 32 bytes criptográficos, se guarda solo su
  SHA-256, se busca dentro de la academia del nombre corto y viaja en el cuerpo o en una cabecera, nunca en la dirección
  de la API. Toda cabecera que lo lleve (o que lleve una dirección de la web que lo contenga, como `Referer`) se redacta
  en el registro técnico (criterio 53).
- **Límites de `GET` (ronda 1).** Toda regla de límite por IP para `GET` vale también para `HEAD`, con el mismo contador
  (criterio 49).
- **Límites por conexión (DR-15).** Toda regla nueva de límite por IP o por conexión cuenta con `claveDeConexion`: IPv4
  exacta (también la mapeada a IPv6) e IPv6 por bloque /64 (criterios 59 y 60).
- **Vista de seguimiento (DR-14).** El nombre solo aparece en la solicitud vigente del cliente y si no está `VENCIDA`
  ni `CANCELADA`. Si la 007 permite más de una solicitud no vencida ni cancelada por alumno, el nombre va solo en la más
  reciente; sus estados nuevos deciden con esa misma regla si muestran la vista completa o la reducida (criterio 58).
- **Destinatarios del enlace de seguimiento (DR-13).** El enlace va al correo del alumno y al del apoderado, una vez por
  dirección distinta (criterio 57). Si la 007 vuelve a enviar el enlace (por ejemplo, tras un rechazo, D-05), usa los
  mismos destinatarios.
- **Proveedores externos (ronda 1).** Un aviso después de confirmar que llama a un proveedor externo (como el correo) no
  retiene la respuesta (criterio 51), y el fallo de un proveedor externo se registra solo con el tipo del error, nunca
  con su mensaje ni sus propiedades, que pueden llevar destinatarios o datos personales (criterio 52).

## Riesgos aceptados

- **Saber si un DNI está en la academia:** HU-01 exige avisar que el DNI ya está registrado, así que cualquiera que
  complete el formulario puede saber si un DNI es de un alumno, de un cliente con solicitud en curso o del personal. Se
  mitiga con un mensaje único para los tres casos (criterio 21), los límites por IP (criterio 33) y la necesidad de un
  formulario completo y válido. Aceptado por el responsable (DR-6).
- **Reservas falsas:** sin verificar la identidad, alguien puede reservar cupos con DNI inventados. Lo limitan la reserva
  de 24 horas (N1), el límite por conexión (criterio 25, N8), los límites por IP y la cancelación por la secretaria
  (criterio 39, desde la 005b; entre los dos PR solo el vencimiento libera los cupos). Una red de muchas IP podría
  llenar cupos por un día.
- **IP detrás de un proxy:** hoy no hay `trust proxy` (DT-1 de 002). Detrás del proxy del hosting, todas las peticiones
  tendrían la misma IP: los límites de los criterios 25 y 33 contarían a todos juntos y bloquearían la inscripción
  pública. Se resuelve al elegir el hosting (D-21), antes de publicar el formulario (DT-9; aviso en las notas de
  hosting de `specs/backlog.md`).
- **Contadores en memoria por instancia** (PO-6 de 002): con varias instancias, cada límite vale por instancia.
- **El token en la dirección de la web:** D-27 fija `/a/{academia}/solicitud/{token}`; esa dirección queda en el
  historial del navegador y en los registros del servidor de la web o del proxy. Se mitiga con `no-referrer`, sin
  recursos de otros dominios y una vista mínima (criterios 32 y 44). Alternativa para el hosting: llevar el token tras
  `#`, que el navegador no envía.
- **Datos de solicitudes que nunca se pagaron:** quedan guardados (datos personales y médicos de personas que no llegaron
  a ser alumnas). Falta una política de retención y borrado (Ley 29733), que se define antes de producción.
- **Cifrado de los datos médicos:** se protegen con RLS, privilegios mínimos, vista mínima y sin registros; el cifrado en
  reposo depende del hosting (N7 b).
- **Correo que no llega (ronda 1):** como la respuesta no espera al correo (criterio 51), si el proceso se detiene
  justo después del 201 o el proveedor falla, el correo se pierde sin reintento. El cliente ve el código y el enlace en
  la pantalla al terminar (criterio 43) y puede consultar con el código y su DNI (criterio 30). Una cola con reintentos
  queda para cuando haya proveedor real (D-19).
- **Regreso de un cliente por un tercero (DR-14, respuesta R3, ronda 1):** con el criterio 21 b, cualquiera que
  conozca el DNI de un cliente cuya solicitud venció o se canceló puede enviar un formulario con ese DNI y reemplazar
  sus datos personales, su ficha médica y su apoderado (o borrarlo), sin que quede copia de los anteriores. Aceptado por
  el responsable: la identidad se comprueba en recepción con el DNI físico al pagar. Se mitiga con la vista reducida
  del enlace anterior, que ya no muestra el nombre (criterio 58), y con los límites por conexión (criterios 25, 33, 59
  y 60). Para los pagos por Yape o transferencia, que no pasan por recepción, cuándo se comprueba el DNI físico queda
  como pregunta de la 007 (anotada en `specs/backlog.md`).
- **IPv6 agrupada por /64 (DR-15, respuesta R4, ronda 1):** una conexión con un bloque mayor (un /56 o un /48, que
  algunos proveedores entregan) puede repartir sus peticiones entre muchos /64 y multiplicar los límites; un proveedor
  que comparte un /64 entre muchos clientes, o una red NAT64, los junta en un solo límite. Aceptado: es el mismo
  compromiso que con IPv4 detrás de un router.
- **Textos legales provisionales:** los consentimientos y el deslinde llevan un texto genérico hasta que la academia
  los revise con un abogado (N7).
- **[005b] Foto sin dueño visible:** en esta historia nadie ve la foto; un error al guardarla solo se nota en la 008. Las
  pruebas del criterio 35 comprueban el archivo guardado.
- **[005b] Archivo huérfano:** si el proceso se cae entre guardar la foto nueva y confirmar, queda un archivo sin referencia que
  nadie puede leer (criterio 37). Una limpieza periódica queda para cuando haya proveedor de archivos.

## Decisiones

**Cómo se citan.** Las decisiones del responsable de esta spec se citan como "DR-n" en esta sección y como "DR-n de
005" fuera de ella; las del orquestador, "DT-n" y "DT-n de 005"; las técnicas de la ronda 1 del ataque, "AT1-n". Los criterios, el contrato y las demás secciones se
escribieron antes de la aprobación y no cambian de intención: donde dicen "pregunta Nn" o "Nn" se refieren a DR-n de
005 y donde dicen "pregunta Tn" o "Tn", a DT-n de 005. Los valores que la spec llama "provisionales" (24 horas de
reserva, desde cuándo se cuentan las clases, solo el mes en curso, una clase por día, campos obligatorios y formato del
celular, DNI ya registrado, consentimientos y versión de sus textos, límite de 5 solicitudes por conexión, vista
mínima, límites por IP y límites de las imágenes) quedan aprobados para el MVP. Los textos de los consentimientos siguen
siendo provisionales en su redacción hasta que la academia los revise con un abogado (DR-7).

### Decisiones del responsable (20/11/2026)

Bryan aprobó la especificación y aceptó la propuesta de cada pregunta de negocio ("De acuerdo con todas, apruebo la
005"), incluida la división en 005a y 005b. Se conserva el texto de cada pregunta y su propuesta, que es lo decidido.

- **DR-1 (pregunta N1). ¿Cuánto dura la reserva del cupo antes de pagar?** Los documentos dicen que el cupo se reserva
  mientras el pago está pendiente de verificación, sin límite (RN-28), pero no dicen qué pasa entre que la persona envía
  el formulario y paga. **Decidido (la propuesta):** el cupo queda reservado desde que envía el formulario y tiene
  **24 horas** para pagar (en recepción o subiendo el Yape, cuando exista la 007); si no paga, el cupo se libera solo y
  la solicitud queda "vencida". Cuando sube el comprobante, la reserva ya no vence hasta que la secretaria lo revise
  (RN-28). El valor es fijo en esta historia; si se quiere, se vuelve configurable por academia más adelante (criterios
  16 y 20).
- **DR-2 (pregunta N2). ¿Desde cuándo se cuentan las clases del cobro proporcional?** **Decidido (la propuesta):** desde
  el momento en que envía el formulario; la clase de hoy cuenta solo si todavía no empezó. El monto queda fijo al
  enviar, aunque la secretaria verifique el pago días después. Y, siguiendo HU-34 al pie de la letra, quien se inscribe
  el día 1 en un mes que tiene menos clases que el plan (por ejemplo, 11 en vez de 12) paga la parte proporcional
  (11/12) (criterios 8 y 9).
- **DR-3 (pregunta N3). ¿Se puede inscribir para el mes siguiente?** **Decidido (la propuesta):** en esta historia, solo
  para el mes en curso. Si ya no quedan clases en el mes (por ejemplo, el último día por la noche), el formulario lo
  dice y pide volver el día 1. La inscripción para el mes siguiente llega con la renovación (010), que es la que respeta
  la prioridad de los alumnos actuales (D-06).
- **DR-4 (pregunta N4). ¿El horario es el mismo todos los días?** **Decidido (la propuesta):** cada día elegido puede
  tener su propia hora, dentro de los días y horas que permite el plan, con una sola clase por día (por ejemplo, lunes a
  las 17:00 y miércoles a las 18:00) (criterio 15 b).
- **DR-5 (pregunta N5). ¿Qué datos son obligatorios?** **Decidido (la propuesta):** obligatorios: nombres, apellidos,
  DNI, fecha de nacimiento, celular (9 dígitos, empieza con 9), nivel, plan y clases, tipo de sangre (con la opción "No
  sé"), contacto de emergencia (nombre y celular) y los dos consentimientos; para menores, además, nombres, apellidos,
  DNI, celular y parentesco (padre, madre u otro apoderado) del apoderado. Opcionales: correo (si se da, ahí llega el
  enlace), dirección, grado del colegio (lista de inicial a 5.° de secundaria, o "no estudia"), enfermedades, alergias,
  medicamentos, seguro, correo del apoderado y la foto. No se piden sexo ni colegio (el modelo los menciona, pero HU-01
  no; menos datos es menos riesgo con la Ley 29733). Edad: de 0 a 100 años, sin mínimo (criterios 12 y 13).
- **DR-6 (pregunta N6). ¿Qué pasa si el DNI ya está registrado?** **Decidido (la propuesta):** se rechaza con un mismo
  mensaje ("Este DNI ya tiene una inscripción o solicitud en esta academia; usa tu enlace o acércate a recepción") si es
  de un alumno, de un cliente con una solicitud en curso o de alguien del personal. Si es de un cliente cuya solicitud
  anterior venció o fue cancelada, se acepta y se reemplazan sus datos. Riesgo aceptado: este aviso, que pide HU-01,
  permite que cualquiera sepa si un DNI está en la academia; se frena con límites por conexión (criterio 21 y "Riesgos
  aceptados").
- **DR-7 (pregunta N7). Consentimientos y textos legales.**
  - a) **Decidido (la propuesta):** dos casillas obligatorias (tratamiento de datos personales, que menciona
    expresamente los datos de salud y de menores, y deslinde de responsabilidad) y una opcional de **uso de imagen** para
    las fotos y videos de progreso (la usará la 014; no marcarla no impide inscribirse). La foto del carnet queda
    cubierta por el tratamiento de datos. Si es menor, acepta el apoderado. Se usan textos genéricos provisionales con el
    nombre de la academia; **antes de salir a producción, la academia debe revisarlos con un abogado** (criterio 14).
  - b) **Datos médicos. Decidido (la propuesta):** se protegen con accesos por rol, sin mostrarlos en el seguimiento ni
    en los registros, y con el cifrado de disco del hosting; cifrado adicional por campo solo si el abogado lo pide.
- **DR-8 (pregunta N8). Límites contra el abuso.** **Decidido (la propuesta):** como mucho **5 solicitudes sin pagar a
  la vez desde una misma conexión** (una familia con varios hijos entra; alguien que intenta llenar las clases, no),
  además de límites por minuto y por hora a cada pantalla pública (criterios 25 y 33).
- **DR-9 (pregunta N9). ¿Qué muestra el enlace de seguimiento y por cuánto tiempo?** **Decidido (la propuesta):** solo
  el código, el estado, el primer nombre, el plan, los días y horas, el mes, las clases, el monto, la fecha límite de la
  reserva y el teléfono de la academia; nunca DNI, apellidos, salud, apoderado ni foto. El enlace no caduca; después de
  vencida o cancelada solo muestra ese estado. El cliente no puede cancelar desde el enlace: llama a la academia
  (criterio 32).
- **DR-10 (pregunta N10). ¿Cómo inscribe la secretaria a quien llega a recepción?** **Decidido (la propuesta):** con el
  mismo formulario público, abierto desde el panel ("Nueva inscripción"); la persona lee y acepta los consentimientos en
  la pantalla. El cobro en efectivo llega con la 007. Las solicitudes las ven y cancelan (con motivo) la secretaria y el
  administrador (criterios 38, 39 y 46, de la 005b; hasta entonces, la secretaria abre la dirección pública del
  formulario).
- **DR-11 (pregunta N11). ¿Dividimos la historia?** Es grande: formulario, cupo, cobro, seguimiento, foto, panel y aforo
  con inscritos. **Decidido (la propuesta):** se divide en dos entregas, las dos de ruta crítica, cada una con sus
  pruebas protegidas, su ataque y su PR:
  - **005a · Inscripción, reserva y seguimiento:** criterios 1 a 33, 41 a 45, 47 y 48 (tablas, oferta, cálculo, envío
    con el último cupo, seguimiento, límites, teléfono público, aforo con inscritos, web pública). Se construye primero.
  - **005b · Foto y panel de solicitudes:** criterios 34 a 40 y 46 (`AlmacenArchivos`, `sharp` y la foto; lista,
    cancelación y ocupación en el panel). Siguiente PR.

  Las dos quedan en esta misma carpeta (`specs/005-inscripcion-publica/`), con sus tareas marcadas en `tasks.md`. Cómo
  se reparten las partes compartidas y cómo se resuelven las dependencias: "División en 005a y 005b".

### Decisiones técnicas del orquestador (20/11/2026)

El orquestador aprobó las nueve propuestas técnicas tal como estaban. Se conserva el texto de cada pregunta y su
propuesta.

- **DT-1 (pregunta T1). Foto en una segunda petición binaria.** **Decidido (la propuesta):** `PUT` con `image/jpeg` o
  `image/png` y el token en `X-Token-Solicitud`, después de crear la solicitud, con un lector binario solo en esa ruta.
  Alternativas descartadas: la imagen en base64 dentro del JSON (obliga a subir el límite de 100 KB de todo el cuerpo y
  suma un 33 %) y `multipart/form-data` (otro lector y otra superficie de ataque). _(005b.)_
- **DT-2 (pregunta T2). Actor `PUBLICO` en la auditoría** para lo que hace un visitante sin cuenta (agrega un valor a
  `tipo_actor`). **Decidido (la propuesta).** Alternativa descartada: `SISTEMA` con el origen en `datosDespues` (sin
  migración del tipo, pero mezcla visitantes con tareas programadas). _(005a.)_
- **DT-3 (pregunta T3). Clasificación.** **Decidido (la propuesta):** críticos 1 a 10, 12 a 39, 41 y 42; prueba
  obligatoria 11, 40 y 43 a 46; revisor 47 y 48. Repartidos entre 005a y 005b como dice "División en 005a y 005b".
- **DT-4 (pregunta T4). `GET /api/a/{nombreCorto}` suma `telefono`.** **Decidido (la propuesta):** cambia la forma del
  criterio 58 de 001 y su prueba protegida, solo para sumar el campo. Alternativa descartada: una ruta nueva para el
  teléfono (una petición más en cada página pública). _(005a.)_
- **DT-5 (pregunta T5). Ocupación en una ruta aparte** (D8) y no en `claseSchema`. **Decidido (la propuesta).**
  _(005b, criterio 40.)_
- **DT-6 (pregunta T6). `sharp` como dependencia del backend** (D-25), con su binario por sistema operativo (la
  integración continua en Windows lo comprueba, D-26). **Decidido (la propuesta).** _(005b.)_
- **DT-7 (pregunta T7). Límites por IP del criterio 33.** **Decidido (la propuesta):** 60 por minuto las lecturas, 30
  por minuto la cotización, 10 por hora el envío, 10 por minuto la consulta y 10 por hora la foto, en memoria como los
  de 002. _(005a, salvo el de la foto, que es de la 005b.)_
- **DT-8 (pregunta T8). El correo simulado no registra el destinatario ni el enlace** (criterio 27), aunque D-19 diga
  que "registra el mensaje": el enlace es una credencial y el registro técnico nunca lleva tokens (criterio 43 de 002).
  En desarrollo el enlace se ve en la respuesta y en la pantalla. **Decidido (la propuesta).** _(005a.)_
- **DT-9 (pregunta T9). `trust proxy`.** **Decidido (la propuesta):** se configura con el hosting (D-21) **antes de
  publicar el formulario** (riesgo "IP detrás de un proxy"). Sin eso, detrás de un proxy todas las peticiones llegan con
  la misma IP y los límites por IP de esta historia (criterios 25 y 33) bloquean a todos a la vez. Esta historia no
  configura `trust proxy`; el aviso queda en las notas de hosting de `specs/backlog.md`.

### Decisiones de diseño (técnicas)

Propuestas del especificador, aprobadas con la spec (20/11/2026).

- **D1. La reserva es una matrícula `RESERVADA` con vencimiento.** La ocupación cuenta matrículas por mes, y la reserva
  sin pagar vence por tiempo, calculado al leer (`reserva_vence_en > ahora`), sin tarea programada. Alternativa
  descartada: un contador de inscritos en la clase (se desincroniza, D5 de 004) o una tarea que libere reservas (puede
  quedar vieja entre ejecuciones, como D10 de 004).
- **D2. El alumno existe desde la solicitud, en estado `CLIENTE`** (sección 8.8, RN-01), y la 007 lo pasa a
  `ALUMNO_ACTIVO`. Alternativa descartada: guardar los datos solo en la solicitud y copiarlos al confirmar (dos copias de
  datos sensibles y otra forma de hacer único el DNI).
- **D3. El cupo se comprueba al enviar, con las clases bloqueadas;** la cotización no reserva. Alternativa descartada:
  reservar al cotizar (cualquiera bloquearía cupos sin dejar datos).
- **D4. El monto visto viaja en el envío** (`montoMostrado`, `mes`) y debe coincidir (criterio 19). Alternativa
  descartada: aceptar el monto nuevo sin avisar (el cliente pagaría algo que no vio).
- **D5. Token guardado como hash y código de 6 caracteres** (criterio 24). D-05 da `AQ-7F3K9` "por ejemplo"; con un
  carácter más el espacio pasa de 33 millones a mil millones por academia, y la consulta exige además el DNI.
- **D6. Consulta por `POST` con el dato en el cuerpo** (regla de datos personales de 002): ni el token ni el DNI van en la
  dirección de la API.
- **D7. Cálculo exacto en céntimos o racional** (criterio 9): `Decimal` con división y redondeo intermedio puede dar
  S/ 201 donde corresponde S/ 200.
- **D8. Ocupación en una ruta aparte** (`GET /api/clases/ocupacion`) para no cambiar `claseSchema` ni `GET /api/clases`
  de 004, que tienen pruebas protegidas.
- **D9. Un solo apoderado por alumno** (HU-01 pide los datos de "padre, madre o apoderado").

### Precisiones de las pruebas protegidas (005a)

Ambigüedades técnicas que encontró el test-writer de la 005a, resueltas por el orquestador (20/11/2026) antes de escribir
las pruebas protegidas. No cambian ninguna regla de negocio; se citan como "Pn" en los criterios y el contrato.

- **P1 (criterio 10 e interfaces del backend).** `calcularTotal` recibe `base: Racional`, con `Racional = { numerador:
  bigint; denominador: bigint }`, y `descuento?: Descuento`, con `Descuento = { tipo: 'PORCENTAJE' | 'MONTO_FIJO'; valor:
  Decimal }`, como en el plan.
- **P2 (criterio 32).** El campo `nombres` de la vista de seguimiento lleva el primer nombre de pila (DR-9): la primera
  palabra de `alumnos.nombres`. El criterio 32 queda alineado con DR-9 ("el primer nombre").
- **P3 (criterio 32).** En una solicitud `VENCIDA` o `CANCELADA`, la vista de seguimiento no incluye la clave
  `reservaVenceEn` (no es `null`: la clave no existe).
- **P4 (criterio 2 y privilegios).** El rol `aquagestion_app` no tiene `UPDATE` sobre `creado_en` de `apoderados` ni de
  `fichas_medicas`.
- **P5 (criterio 1 y `consentimientos`).** `consentimientos` lleva `UNIQUE (academia_id, id)`, como exige el catálogo de
  001 (criterios 12 y 131).
- **P6 (criterio 4 g).** Un tipo de consentimiento inválido escrito directo en la base se rechaza con `22P02` (valor fuera
  del enum `tipo_consentimiento`) o `23514`; la prueba acepta cualquiera de los dos.
- **P7 (criterio 27 e interfaces del backend).** El token de inyección del enviador de correo es `ENVIADOR_CORREO`,
  exportado desde `backend/src/infraestructura/correo/index.ts`.
- **P8 (criterio 32).** En la vista de seguimiento, `mes` es un texto `AAAA-MM` y `monto` un texto con dos decimales
  (como `"42.00"`).
- **P9 (criterios 1, 2 y 21 b; consulta del orquestador).** El `DELETE` en `apoderados` para el rol app ya estaba
  previsto antes de estas precisiones: criterio 1 (política de `DELETE` solo en `apoderados`), criterio 2 (`DELETE` solo
  en `apoderados`), criterio 21 b (el apoderado "se quita, si ya es mayor"), "Casos límite" (único `DELETE`) y
  "Cambios al modelo de datos" (privilegios). No se agrega nada.
- **P10 (criterio 1 y "Cambios al modelo de datos"; decisión del orquestador, ya aplicada en la migración).** Las llaves
  primarias son `(academia_id, alumno_id)` en `apoderados` y en `fichas_medicas`, y `(academia_id, matricula_id,
  clase_id)` en `matricula_clases`, para cumplir los criterios 126, 131 y 142 de 001 (toda llave primaria de una tabla
  con `academia_id` la incluye, salvo la formada solo por `id`). No cambia ninguna regla de negocio: sigue habiendo un
  apoderado y una ficha por alumno, y una fila por clase de cada matrícula.

### Decisiones técnicas de la ronda 1 del ataque (005a, 20/11/2026)

Propuestas del especificador para las fallas F1 a F5, sin cambios de negocio. Detalle en el plan.

- **AT1-1 (criterio 49).** `HEAD` comparte el contador de `GET` en cada regla. Alternativa descartada: un contador
  aparte para `HEAD` (duplicaría el límite real de lectura) o rechazar `HEAD` con 405 (cambia el comportamiento de
  Express en toda la API y no lo pide ningún criterio).
- **AT1-2 (criterio 50, decisión técnica del orquestador).** Esquema aparte `montoCotizadoSchema` con tope 100000.00.
  Alternativa descartada: subir `MONTO_MAXIMO` de 004 (permitiría precios de 100000 y rompe sus pruebas protegidas) o
  bajar el tope del precio a 99999.00 (cambia una regla aprobada en DR-1 de 004).
- **AT1-3 (criterio 51).** La respuesta no espera nada del correo: el envío se inicia después de confirmar sin `await`,
  con el rechazo siempre atrapado. Alternativa descartada: esperar con un tiempo máximo (por ejemplo 2 s), que retiene
  igual cada 201 hasta ese tiempo con un proveedor lento y no da nada a cambio, porque el resultado del correo no
  cambia la respuesta.
- **AT1-4 (criterio 52).** Solo el nombre de la clase del error. Alternativa descartada: `errorParaRegistro`, pensado
  para errores de la base, que devuelve tal cual un `Error` cualquiera con su mensaje y sus propiedades.
- **AT1-5 (criterio 53).** Redactar `req.headers.referer` en toda la API. Alternativa descartada: redactarla solo en
  las rutas públicas (el navegador puede mandarla a cualquier ruta, y el panel puede abrirse desde la misma pestaña).

### Decisiones del responsable sobre la ronda 1 (20/11/2026)

Respuestas de Bryan a las preguntas R1 a R5 de la ronda 1 de la 005a. Se conserva cada pregunta, resumida, con lo
decidido.

- **DR-12 (pregunta R1, ronda 1). Reserva que cruza el mes.** Una solicitud enviada el 30 de noviembre a las 10:00
  reservaba una matrícula de noviembre hasta el 1 de diciembre a las 10:00. **Decidido:** la reserva vence a las 24
  horas o a las 23:59:59.999 del último día del mes de la matrícula en America/Lima, lo que ocurra primero. Nunca queda
  una reserva vigente de un mes ya cerrado. Afecta a `reservaVenceEn` (201, auditoría y seguimiento), a la ocupación y
  los inscritos, al vencimiento de la solicitud, a `DNI_YA_REGISTRADO` y al límite por conexión (desde el día 1 la
  persona puede volver a inscribirse) y a la semilla (criterios 16, 47 d y 54 a 56). Modifica DR-1 solo en el tope.
- **DR-13 (pregunta R2, ronda 1). Correo de un menor.** **Decidido:** el enlace de seguimiento se envía al correo del
  alumno y, si el apoderado dio correo, también al del apoderado; si los dos son el mismo, una sola vez. El registro
  técnico sin destinatarios ni enlace (criterio 52) y la respuesta que no espera al correo (criterio 51) valen para los
  dos envíos (criterios 27 y 57).
- **DR-14 (pregunta R3, ronda 1). Regreso de un cliente con su DNI por un tercero (criterio 21 b).** **Decidido:** se
  acepta el riesgo; la identidad se comprueba en recepción con el DNI físico al pagar. Además, la vista de seguimiento
  de una solicitud que ya no es la vigente del cliente, o de cualquier solicitud `VENCIDA` o `CANCELADA`, no muestra el
  nombre: solo el estado y los datos no personales (criterio 58). Queda en "Riesgos aceptados".
- **DR-15 (pregunta R4, ronda 1). IPv6.** **Decidido:** los límites por conexión (criterio 25, máximo 5 reservas sin
  pagar, y criterio 33, límites por minuto) cuentan las direcciones IPv6 por bloque /64; las IPv4, incluidas las IPv6
  mapeadas a IPv4 (`::ffff:a.b.c.d`), por dirección exacta (criterios 59 y 60). Se aplica a todas las reglas del
  criterio 33, también al envío (10 por hora), que es un límite del mismo criterio, y a la foto en la 005b (AT1-9).
- **DR-16 (pregunta R5, ronda 1). DNI del personal igual al de un cliente.** **Decidido:** no se resuelve en la 005. Pasa
  como pregunta abierta a la historia que crea la cuenta del alumno (007) y queda anotada en `specs/backlog.md` junto a
  esa historia. En la 005 sigue el criterio 21 a (se rechaza la inscripción con el DNI de alguien del personal) y la
  creación de personal de la 002 no cambia.

### Decisiones técnicas de las respuestas de la ronda 1 (005a, 20/11/2026)

Propuestas del especificador para llevar DR-12 a DR-15 al código, sin cambios de negocio. Detalle en el plan.

- **AT1-6 (criterios 54 a 56).** Función pura `vencimientoDeReserva` en el dominio de matrículas y, además, un `CHECK`
  en la base, en una migración nueva. Alternativas descartadas: solo la función (una semilla, una utilidad o una
  historia futura podrían escribir una reserva que cruce el mes); una tarea programada que venza las reservas al cerrar
  el mes (esta historia no tiene tareas programadas, D1); editar la migración de la 005a (ya aplicada en las bases de
  desarrollo de la rama; Prisma la vería cambiada).
- **AT1-7 (criterio 57).** Una llamada a `enviar` por destinatario distinto, con la interfaz `EnviadorCorreo` sin
  cambios (`para: string`). Alternativa descartada: una sola llamada con varios destinatarios (cambia la interfaz, el
  fallo de uno arrastra al otro y un error del proveedor llevaría los dos correos).
- **AT1-8 (criterio 58).** La vista reducida no lleva `nombres` ni `fotoCargada`, y `vistaSolicitudSchema` pasa a ser
  una unión estricta por estado. `fotoCargada` se quita porque se lee del alumno (no de la solicitud) y, tras un regreso
  por un tercero, describe los datos nuevos, no los de esa solicitud; además, en `VENCIDA` y `CANCELADA` no se puede
  subir una foto. Alternativa descartada: `nombres: null` (contradice P3, que quita la clave) o dejar `fotoCargada`.
- **AT1-9 (criterios 59 y 60).** Función pura `claveDeConexion`, usada en la clave del almacén de límites, en el bloqueo
  consultivo de la IP del envío y en el conteo de solicitudes activas (que compara por bloque en SQL); `ip_origen`
  guarda la dirección exacta. Las pruebas de integración fijan la IP con `X-Forwarded-For` en una app de prueba con
  `trust proxy` en `loopback`; la app real no cambia (DT-9). Alternativas descartadas: una columna nueva con la clave
  (otra migración y cambios en las pruebas protegidas de catálogo) o guardar solo el bloque en `ip_origen` (se pierde la
  dirección exacta).
- **AT1-10 (criterio 47 d).** La reserva vigente de la semilla vence al fin del mes en Lima, no a las 24 horas, para
  que el ejemplo dure lo más posible sin cruzar el mes. Alternativa descartada: las 24 horas del formulario (el ejemplo
  dejaría de estar vigente al día siguiente de sembrar).

## Preguntas abiertas

Las preguntas N1 a N11 y T1 a T9 quedaron decididas el 20/11/2026 (DR-1 a DR-11 y DT-1 a DT-9, en "Decisiones", con el
texto de cada pregunta y su propuesta).

Las preguntas R1 a R5 de la ronda 1 de la 005a quedaron respondidas por el responsable el 20/11/2026: R1 a R4 son
DR-12 a DR-15 (criterios 54 a 60) y R5 pasó a la 007 (DR-16, anotada en `specs/backlog.md` junto a esa historia).

### Pendientes de respuesta del responsable (respuestas de la ronda 1)

No bloquean: **mientras no haya respuesta, rige lo que ya dice la spec**; si la respuesta cambia algo, se agrega como
criterio nuevo con su origen.

- **R6. IPv6 en el límite del ingreso (002).** DR-15 agrupa por /64 los límites de la inscripción (criterios 25 y 33),
  pero el límite de 10 intentos por minuto del ingreso a la academia (002) sigue contando cada dirección por separado,
  así que con IPv6 se salta igual que antes. La nota de hosting de la 002 en `specs/backlog.md` ya prevé agruparlas por
  /64, pero sin fecha. ¿Se aplica también ahí la clave de conexión? _Propuesta:_ sí, con la misma función
  `claveDeConexion`, en un cambio pequeño con su prueba protegida, dentro de la 005a (el middleware es el mismo) o en
  una historia aparte si se prefiere no tocar la 002 ahora. _Mientras tanto:_ el ingreso no cambia.
