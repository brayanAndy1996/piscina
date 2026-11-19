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
- **Estado:** borrador (19/11/2026). Pendiente de aprobación del responsable; ver "Preguntas abiertas" (N1 a N11 de
  negocio y T1 a T9 técnicas). La pregunta N11 propone dividir la historia en 005a y 005b.

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

No son críticos, pero llevan _(prueba obligatoria)_: 11 (cotización, salvo lo que cubren 8 a 10) y 40 (API), y 43 a
46 (web, con pruebas de componentes). Los 47 y 48 (semilla y documentación) los verifica el revisor.

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
- **Reserva sin pago:** 24 horas desde el envío (provisional, pregunta N1).
- **Vista mínima:** lo que muestra el enlace de seguimiento (criterio 32).

### A. Tablas, aislamiento y privilegios en la base

1. **Tablas nuevas.** Dadas las migraciones aplicadas, entonces existen `alumnos`, `apoderados`, `fichas_medicas`,
   `consentimientos`, `solicitudes_inscripcion`, `matriculas` y `matricula_clases`, con las columnas de "Cambios al
   modelo de datos", con `academia_id`, RLS activada y forzada, políticas de `SELECT`, `INSERT` y `UPDATE` con la forma
   exacta del criterio 132 de 001 (y de `DELETE` solo en `apoderados`, pregunta N6), y `UNIQUE (academia_id, id)` en las
   que reciben llaves. Toda referencia entre ellas y hacia `planes`, `clases` y `usuarios` es una llave foránea
   compuesta `(academia_id, …) → (academia_id, id)`. Todas las pruebas de catálogo de 001 (criterios 9 a 13, 17, 18, 124
   a 126 y 131 a 133) siguen pasando y `TABLAS_DESPUES_DE_MIGRAR` suma las siete. _(crítico)_ (D-17, D-23; criterio 12
   de 001)
2. **Privilegios mínimos.** Dado el rol `aquagestion_app`, entonces sus privilegios son exactamente los de "Cambios al
   modelo de datos" (`SELECT` e `INSERT` en las siete; `UPDATE` solo de las columnas listadas; `DELETE` solo en
   `apoderados`); no puede cambiar el DNI de un alumno, el código ni el token de una solicitud, ni la `academia_id` de
   ninguna fila, ni borrar consentimientos, solicitudes ni matrículas. `PRIVILEGIOS_APP` y `scripts/lib/rol-app.mjs` se
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
   - g) `consentimientos` con un tipo fuera de `DATOS_PERSONALES`, `DESLINDE` e `IMAGEN`, o una versión vacía.

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
    (descuento, HU-10). _(crítico)_ (D-03, HU-34)
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
    `claveIdempotencia` que no es un UUID; `mes` que no es `AAAA-MM`; `montoMostrado` que no cumple `montoSchema`;
    controles o caracteres bidireccionales en cualquier texto. Campos obligatorios y opcionales: pregunta N5.
    _(crítico)_ (HU-01)
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
    criterio 9 y `reserva_vence_en` igual a "ahora" más la reserva sin pago. Responde 201 con
    `{ solicitud: { codigo, token, enlace, estado: 'PENDIENTE_PAGO', reservaVenceEn, cotizacion } }`, donde `enlace` es
    `/a/{nombreCorto}/solicitud/{token}`. Desde ese momento la ocupación de cada clase elegida sube en 1. No se crea
    ningún usuario, carnet ni pago (007). _(crítico)_ (HU-01, HU-02, RN-01, RN-27, RN-28, D-05)
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
    entre la cotización y el envío (`MONTO_CAMBIO` si el monto baja). _(crítico)_ (HU-34, HU-19, D-03)
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
    vencidas, canceladas y las de otra academia no cuentan. La IP de origen se guarda en la solicitud. _(crítico)_
    (riesgo de 11.4: cupos bloqueados)
26. **Auditoría.** Cada envío correcto registra `SOLICITUD_INSCRIPCION_CREADA` (entidad `solicitud_inscripcion`,
    `entidadId` el id de la solicitud, actor `PUBLICO` sin id, la IP) con `datosDespues` = `codigo`, `planId`,
    `claseIds`, `mes`, `clasesTotales`, `montoCalculado`, `esProporcional`, `menorDeEdad` y `reservaVenceEn`. Nunca lleva
    el DNI, nombres, fecha de nacimiento, contacto, datos médicos, apoderado, token ni foto. Los rechazos (400, 409, 429)
    no se auditan. _(crítico)_ (RN-22, RNF-06, Ley 29733; pregunta T2)
27. **Correo después de confirmar.** Si el formulario trae correo, después de confirmar la transacción se llama una vez a
    `EnviadorCorreo.enviar` con el enlace de seguimiento y el código. Si la transacción falla, no se llama. Si el envío
    del correo falla, la respuesta sigue siendo el 201 y el fallo queda en el registro técnico (sin el destinatario ni
    el enlace). La implementación simulada (D-19) registra solo la plantilla, la academia y que hubo un envío; nunca el
    destinatario, el enlace ni el token (pregunta T8). _(crítico)_ (D-05, D-19; efectos después de confirmar)
28. **Registro técnico sin datos sensibles.** En ningún nivel, el registro técnico de las rutas de esta historia lleva el
    DNI, nombres, fecha de nacimiento, teléfono, correo, dirección, datos médicos, apoderado, token, código junto con el
    DNI, el cuerpo de la petición ni el contenido de la foto; la línea de la petición de `pino-http` no lleva cuerpo ni
    token (el token nunca va en una dirección de la API). Prueba con un registro en memoria que envía un formulario
    completo, consulta y sube una foto, y busca cada valor. _(crítico)_ (criterio 43 de 002, Ley 29733)

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
    `CANCELADA`; la 007 suma los suyos); `creadaEn`; `reservaVenceEn` (solo en `PENDIENTE_PAGO`); `nombres` (sin
    apellidos); `plan` (`nombre`); `clases` (`nivel`, `diaSemana`, `horaInicio`, `horaFin`); `mes`; `clasesTotales`;
    `monto`; `esProporcional`; y `fotoCargada` (booleano). Nunca lleva DNI, apellidos, fecha de nacimiento, edad,
    teléfono, correo, dirección, datos médicos, apoderado, consentimientos, foto, ids internos (alumno, matrícula,
    solicitud) ni el hash del token. Una solicitud `VENCIDA` o `CANCELADA` muestra lo mismo sin `reservaVenceEn`
    (provisional, N9). _(crítico)_ (RNF-05, Ley 29733, D-05)

### F. Límites de peticiones de las rutas públicas

33. **Límites por IP.** Las rutas públicas de `/api/a` cuentan las peticiones por IP con el almacén de
    `@nestjs/throttler`, antes de leer el cuerpo y antes de buscar la academia (como el ingreso de 002), sumando todas
    las academias, con estos límites provisionales (pregunta T7): `GET /api/a/{nombreCorto}` y
    `GET /api/a/{nombreCorto}/inscripcion`, 60 por minuto en total; la cotización, 30 por minuto; el envío, 10 por hora;
    la consulta de seguimiento, 10 por minuto; la foto, 10 por hora. El límite de 10 por minuto del ingreso (002) no
    cambia. Pasado el límite responde 429 `DEMASIADAS_SOLICITUDES` con `Cache-Control: no-store`, sin leer el cuerpo,
    sin abrir transacción y sin escribir. Cada límite tiene su contador: agotar uno no afecta a los otros. _(crítico)_
    (nota O2 de 001, DT-1 de 002)

### G. Foto opcional

34. **Subida de la foto.** `PUT /api/a/{nombreCorto}/solicitudes/foto`, con el token en la cabecera `X-Token-Solicitud`
    y la imagen como cuerpo binario (`Content-Type: image/jpeg` o `image/png`), responde 204 si el token es de una
    solicitud `PENDIENTE_PAGO` no vencida de la academia cuyo alumno está en estado `CLIENTE`. Responde: 404
    `SOLICITUD_NO_ENCONTRADA` (el mismo del criterio 31) sin token o con un token que no sirve; 409
    `SOLICITUD_NO_EDITABLE` si la solicitud está vencida o cancelada; 400 `IMAGEN_NO_VALIDA` con otro tipo de contenido,
    con un `Content-Encoding` distinto de `identity`, si los primeros bytes no son de JPEG o de PNG, si la imagen no se
    puede decodificar, si tiene menos de 100 o más de 8000 píxeles por lado o más de 40 megapíxeles (provisionales); y
    413 `CARGA_EXCESIVA` con más de 5 MB, sin leer más allá del límite. Una foto nueva reemplaza a la anterior. Ningún
    rechazo cambia la foto guardada. _(crítico)_ (D-20, D-24; límites de `CLAUDE.md`)
35. **La foto que se guarda.** La imagen aceptada se vuelve a codificar con `sharp` como JPEG de como mucho 800 píxeles
    en su lado mayor (sin agrandar), con la orientación aplicada y **sin metadatos** (EXIF, GPS, XMP, ICC, comentarios):
    lo guardado nunca es el archivo original. Prueba: una foto con coordenadas GPS en su EXIF se guarda sin ellas; un PNG
    con un trozo de texto o un JPEG con datos después del final de la imagen se guardan sin ellos; un archivo poliglota
    (PNG válido con otro contenido pegado) se guarda solo como la imagen recodificada. _(crítico)_ (RNF-05: fotos de
    menores)
36. **`AlmacenArchivos` y aislamiento de archivos.** La interfaz `AlmacenArchivos` (`guardar`, `leer`, `borrar`) recibe
    siempre la academia y una clave que genera el servidor (`academias/{academiaId}/alumnos/{alumnoId}/foto-{uuid}.jpg`),
    nunca un nombre que venga del cliente. La implementación de disco local escribe bajo el directorio de
    `ALMACEN_DIRECTORIO` y rechaza toda clave que no cumpla el formato o que, resuelta, quede fuera de ese directorio o de
    la carpeta de la academia (`..`, rutas absolutas, separadores de Windows, bytes nulos, enlaces simbólicos). Leer o
    borrar con la academia A una clave de B falla sin tocar el archivo. Ninguna ruta de la API ni del servidor de la web
    sirve ese directorio. _(crítico)_ (D-21, D-23)
37. **Archivo y transacción, sin restos visibles.** La imagen se procesa y se guarda con una clave nueva antes de la
    transacción; la transacción vuelve a comprobar la solicitud, guarda la clave en `alumnos.foto_clave` y confirma; después
    se borra el archivo anterior. Si la transacción falla, se borra el archivo nuevo y la clave guardada no cambia; si
    falla el borrado del anterior, se registra un aviso (sin datos personales) y la respuesta sigue siendo 204. Dos
    subidas simultáneas con el mismo token dejan una sola foto, la de la última en confirmar, y no dejan un archivo
    referenciado que no exista. Sin auditoría (la foto no es una operación de caja, pago ni horario); la acción queda en
    el registro técnico sin datos personales. _(crítico)_ (efectos después de confirmar; D-21)

### H. Panel: solicitudes, ocupación y aforo con inscritos

38. **Lista de solicitudes.** `GET /api/solicitudes`, con `@Permiso('REGISTRAR_INSCRIPCION_Y_COBRO')` (`ADMIN` y
    `SECRETARIA`), responde 200 con `{ solicitudes }` de la academia de la sesión, de la más nueva a la más antigua, las
    200 más recientes, filtradas por `?estado=` (`ACTIVAS` por defecto, `VENCIDAS`, `CANCELADAS` o `TODAS`); cada una con
    `id`, `codigo`, `estado` (con `VENCIDA` calculado), `creadaEn`, `reservaVenceEn`, `nombres`, `apellidos`, `dni`,
    `telefono`, `menorDeEdad`, `plan` (`id`, `nombre`), `clases`, `mes`, `clasesTotales` y `monto`. Sin datos médicos,
    apoderado, consentimientos, foto, IP ni token. `ENTRENADOR` y `ALUMNO` reciben 403; sin sesión, 401; el Superadmin
    no tiene la ruta (D-29). Nunca aparecen solicitudes de otra academia, tampoco con `?academiaId=`. La lectura no
    audita. _(crítico)_ (sección 2.1, RN-21, D-23)
39. **Cancelar una solicitud.** `POST /api/solicitudes/{id}/cancelar` con `{ motivo }` (de 3 a 200 caracteres
    visibles), con el mismo permiso: dentro de su `conAcademia`, `bloquearActorVigente` primero, después la solicitud
    (`FOR UPDATE`) y después `bloquearClasesParaCupo` con sus clases. Una solicitud `PENDIENTE_PAGO` (vencida o no) pasa a
    `CANCELADA` y su matrícula a `CANCELADA`: el cupo se libera en ese momento. Registra
    `SOLICITUD_INSCRIPCION_CANCELADA` (actor `USUARIO`, `motivo`, `datosAntes` y `datosDespues` con el estado) y responde
    200 con la solicitud. Una ya `CANCELADA` responde 200 sin escribir ni auditar (dos cancelaciones dejan una
    auditoría); un id que no existe, de otra academia o que no es UUID, 404 `NO_ENCONTRADO`. Con el actor desactivado
    mientras espera, 401 sin escribir (prueba de carrera como el criterio 7 de 004). _(crítico)_ (RN-22, RN-28, DT-5 de
    002)
40. **Ocupación para el administrador.** `GET /api/clases/ocupacion`, con
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
    obligatoria, de componentes)_ (HU-01, HU-02, D-05, D-20, D-24)
44. **Página de seguimiento.** `/a/{nombreCorto}/solicitud/{token}` consulta con el token en el cuerpo y muestra la vista
    mínima (estado en palabras, plan, días y horas, mes, monto, fecha límite de la reserva, teléfono de la academia y
    "subir foto" mientras se pueda). `/a/{nombreCorto}/solicitud` ofrece la consulta con código y DNI. La página no guarda
    el token en `localStorage`, `sessionStorage` ni cookies, declara `<meta name="referrer" content="no-referrer">`, no
    carga recursos de otros dominios y no muestra el token en el título. La clave de la consulta en TanStack Query no se
    persiste. _(prueba obligatoria, de componentes)_ (D-05, D-27)
45. **Teléfono en las páginas públicas.** El ingreso de la academia (`/a/{nombreCorto}/ingresar`, de 002), la inscripción
    y el seguimiento muestran el teléfono de la academia cuando existe, leído de `GET /api/a/{nombreCorto}` sin caché
    entre visitas (DR-4 de 003). _(prueba obligatoria, de componentes)_
46. **Panel.** El inicio del panel muestra "Solicitudes de inscripción" a `ADMIN` y `SECRETARIA` (según
    `puede(rol, 'REGISTRAR_INSCRIPCION_Y_COBRO')`) y "Nueva inscripción", que abre el formulario público de la academia
    en recepción (pregunta N10). `/panel/solicitudes` lista con filtro por estado y cancela con un diálogo que pide el
    motivo. `/panel/clases` muestra en cada clase "inscritos / aforo" y, al bajar el aforo por debajo de los inscritos,
    un diálogo de confirmación que reenvía con `confirmarAforoMenor: true`; al desactivar una clase con inscritos,
    explica que primero hay que moverlos o cancelar sus solicitudes. Las claves de las consultas incluyen la identidad de
    la sesión y los formularios cumplen las lecciones de la 003 (criterio 29 de 004). _(prueba obligatoria, de
    componentes)_

### J. Semilla y documentación

47. **Semilla.** `delfines` tiene, inventados, un cliente con una solicitud `PENDIENTE_PAGO` vigente, uno con una
    reserva vencida y uno menor de edad con apoderado, sobre los planes y clases de la 004; ninguna clase queda por
    encima de su aforo. `tiburones` queda sin solicitudes. Se puede ejecutar dos veces sin duplicar ni pisar lo editado.
    Los tokens de la semilla no se imprimen ni se guardan en claro (solo sus hashes); los datos médicos son inventados y
    neutros. _(verificación del revisor)_
48. **Documentación.** `docs/arquitectura.md` documenta las tablas, la ocupación (`contarOcupacion`), el orden de
    bloqueos, `AlmacenArchivos`, `EnviadorCorreo`, los límites de las rutas públicas y las "Reglas para las historias
    siguientes" de esta spec; el `README.md` y la guía de uso explican la inscripción, el seguimiento y el panel de
    solicitudes; `.env.example` suma `ALMACEN_DIRECTORIO`. _(verificación del revisor)_

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
| `PUT /api/a/{nombreCorto}/solicitudes/foto` | pública, cabecera `X-Token-Solicitud` | JPEG o PNG, hasta 5 MB | 204 | 400 `IMAGEN_NO_VALIDA`, 404, 403, 409 `SOLICITUD_NO_EDITABLE`, 413, 429 |
| `GET /api/solicitudes?estado=` | `REGISTRAR_INSCRIPCION_Y_COBRO` | — | 200 `RespuestaListaSolicitudes` | 400, 401, 403 |
| `POST /api/solicitudes/{id}/cancelar` | `REGISTRAR_INSCRIPCION_Y_COBRO` | `cancelarSolicitudSchema` | 200 `RespuestaSolicitudPanel` | 400, 401, 403, 404, 409 `SOLICITUD_NO_CANCELABLE` |
| `GET /api/clases/ocupacion` | `CONFIGURAR_PLANES_HORARIOS_AFORO` | — | 200 `RespuestaOcupacion` | 401, 403 |
| `PATCH /api/clases/{id}` (de 004) | `CONFIGURAR_PLANES_HORARIOS_AFORO` | `actualizarClaseSchema` + `confirmarAforoMenor` | 200 | los de 004 + 409 `AFORO_MENOR_QUE_INSCRITOS`, `CLASE_CON_INSCRITOS` |

**Orden de los 409 del envío** (después del 400 del esquema y de los 400 de los criterios 13 y 14):
`SOLICITUD_YA_REGISTRADA` → `TEXTOS_ACTUALIZADOS` → `MES_CAMBIO` → `PLAN_NO_DISPONIBLE` → `DNI_YA_REGISTRADO` →
`LIMITE_DE_RESERVAS_PENDIENTES` → `SELECCION_NO_VALIDA` → `SIN_CLASES_EN_EL_MES` → `SIN_CUPO` → `MONTO_CAMBIO`. Desde
`SELECCION_NO_VALIDA`, se deciden con las clases ya bloqueadas (sigue el orden de bloqueos de "Reglas para las historias
siguientes"). La cotización usa el mismo orden para los códigos que comparte. `SOLICITUD_NO_CANCELABLE` (409) es para una solicitud que ya no está `PENDIENTE_PAGO` ni `CANCELADA` (desde la
007).

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
  usan la API y la web). Reutiliza `dniSchema`, `nivelNatacionSchema`, `fechaSchema`, `montoSchema` y
  `textoVisibleSchema`.
- `consentimientos.ts`: `VERSION_CONSENTIMIENTOS`, `TIPOS_CONSENTIMIENTO` (`DATOS_PERSONALES`, `DESLINDE`, `IMAGEN`) y
  `textosConsentimiento(nombreAcademia, { menor })`.
- `solicitudes.ts`: `codigoSolicitudSchema` (recorta y pasa a mayúsculas; `^AQ-[0-9A-HJKMNP-TV-Z]{6}$`),
  `tokenSeguimientoSchema` (`^[A-Za-z0-9_-]{43}$`), `consultarSolicitudSchema` (unión estricta: `{ token }` o
  `{ codigo, dni }`, cada uno un texto de hasta 100 caracteres; el formato del token, del código y del DNI lo comprueba
  el servicio y, si no se cumple, responde el 404 del criterio 31, no un 400), `estadoSolicitudSchema`, `vistaSolicitudSchema` (criterio 32), `respuestaConsultaSolicitudSchema`,
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
function calcularTotal(entrada: { base: Racional; montoAjustado?: Decimal; descuento?: Descuento }): Decimal; // entero

// backend/src/infraestructura/almacen-archivos/
interface AlmacenArchivos {
  guardar(academiaId: string, clave: string, contenido: Buffer, tipo: 'image/jpeg' | 'image/png'): Promise<void>;
  leer(academiaId: string, clave: string): Promise<Buffer>;
  borrar(academiaId: string, clave: string): Promise<void>;
}
// backend/src/infraestructura/correo/
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
- **`apoderados`:** `alumno_id` PK y llave compuesta a `alumnos`, `academia_id`, `nombres`, `apellidos`, `dni`,
  `telefono`, `parentesco`, `correo null`, fechas. Uno por alumno (HU-01).
- **`fichas_medicas`:** `alumno_id` PK y llave compuesta, `academia_id`, `tipo_sangre`, `enfermedades null`,
  `alergias null`, `medicamentos null`, `seguro null`, `contacto_emergencia_nombre`, `contacto_emergencia_telefono`,
  fechas. Sin `observaciones` en esta historia (lo agrega quien la use, 012).
- **`consentimientos`:** `id`, `academia_id`, `alumno_id` (llave compuesta), `solicitud_id` (llave compuesta), `tipo`,
  `version text` (no vacía), `aceptado_en timestamptz`, `ip inet null`, `otorgado_por`, y el valor para `IMAGEN`
  (`aceptado boolean`; para los otros dos siempre `true`). Solo `INSERT`: es evidencia (D-07).
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
- **`matricula_clases`:** `academia_id`, `matricula_id` y `clase_id` (llaves compuestas), PK `(matricula_id, clase_id)`,
  índice `(academia_id, clase_id)` para contar la ocupación.
- **Privilegios de `aquagestion_app`** (criterio 2): `SELECT` e `INSERT` en las siete; `UPDATE` de `alumnos` (`nombres`,
  `apellidos`, `fecha_nacimiento`, `telefono`, `correo`, `direccion`, `grado_colegio`, `nivel`, `foto_clave`,
  `actualizado_en`), `apoderados` (todas menos `alumno_id` y `academia_id`), `fichas_medicas` (todas menos `alumno_id` y
  `academia_id`), `solicitudes_inscripcion` (`estado`, `actualizado_en`) y `matriculas` (`estado`, `reserva_vence_en`,
  `actualizado_en`); `DELETE` solo en `apoderados` (con su política). La 007 y la 010 amplían lo que necesiten (por
  ejemplo `alumnos.estado` y `usuario_id`) en sus propias migraciones.
- `PRIVILEGIOS_APP`, `scripts/lib/rol-app.mjs` y `TABLAS_DESPUES_DE_MIGRAR` se amplían en el mismo cambio.

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
- **001, criterio 127 (dependencias del backend):** `sharp` se suma a `DEPENDENCIAS_BACKEND_PERMITIDAS` (D-25; T6).
- **001, lector de cuerpos (criterio 74):** la ruta de la foto queda fuera de los tres middlewares de JSON (como
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
- **Web de 002:** la página de ingreso muestra el teléfono (criterio 45); el inicio del panel suma dos opciones.
- **`docs/arquitectura.md`:** secciones nuevas (criterio 48).

## Reglas para las historias siguientes

Para documentar en `docs/arquitectura.md` (criterio 48):

- **Orden de bloqueos con alumnos y solicitudes.** `usuarios` (actor, con `bloquearActorVigente`) → bloqueos
  consultivos del envío público, primero el de la IP de origen (`'inscripcion-ip:' || academia || ':' || ip`) y después
  el del DNI (`'inscripcion-dni:' || academia || ':' || dni`), con `pg_advisory_xact_lock(hashtextextended(…, 0))` →
  filas de `alumnos`, `solicitudes_inscripcion` y `matriculas` (`FOR UPDATE`) → `clases` (`bloquearClasesParaCupo`, una
  llamada) → escrituras. Nunca al revés. Las lecturas de `usuarios` sin bloqueo (como la del criterio 21 a) no cuentan.
- **Ocupación.** Se cuenta con `contarOcupacion` o `contarInscritos` después de `bloquearClasesParaCupo` y con "ahora"
  de `RELOJ`. Una matrícula ocupa cupo si está `VIGENTE`, o `RESERVADA` con `reserva_vence_en` nula o posterior a
  "ahora".
- **Para la 007:** al registrar un comprobante, la matrícula queda `RESERVADA` con `reserva_vence_en = NULL` (sin límite,
  RN-28); si la reserva ya había vencido, antes vuelve a pedir cupo (como D-05 tras un rechazo). Al rechazar, la
  matrícula pasa a `CANCELADA` y el cupo se libera. Al confirmar, `VIGENTE`, el alumno pasa de `CLIENTE` a
  `ALUMNO_ACTIVO` y se crea su usuario (HU-04). El total sale de `calcularTotal` con lo guardado en la matrícula
  (`precio_plan`, `clases_por_mes_plan`, `clases_totales`), nunca del plan (HU-19).
- **Archivos.** Toda historia que guarda archivos (comprobantes 007, multimedia 014, certificados) usa `AlmacenArchivos`
  con claves generadas por el servidor bajo `academias/{academiaId}/…`, procesa y guarda antes de la transacción y borra
  lo reemplazado después de confirmar (criterio 37). Las imágenes subidas por el público se recodifican sin metadatos
  (criterio 35).
- **Tokens públicos.** Un token que da acceso sin sesión se genera con 32 bytes criptográficos, se guarda solo su
  SHA-256, se busca dentro de la academia del nombre corto y viaja en el cuerpo o en una cabecera, nunca en la dirección
  de la API.

## Riesgos aceptados

- **Saber si un DNI está en la academia:** HU-01 exige avisar que el DNI ya está registrado, así que cualquiera que
  complete el formulario puede saber si un DNI es de un alumno, de un cliente con solicitud en curso o del personal. Se
  mitiga con un mensaje único para los tres casos (criterio 21), los límites por IP (criterio 33) y la necesidad de un
  formulario completo y válido. Pendiente de confirmar (N6).
- **Reservas falsas:** sin verificar la identidad, alguien puede reservar cupos con DNI inventados. Lo limitan la reserva
  de 24 horas (N1), el límite por conexión (criterio 25, N8), los límites por IP y la cancelación por la secretaria
  (criterio 39). Una red de muchas IP podría llenar cupos por un día.
- **IP detrás de un proxy:** hoy no hay `trust proxy` (DT-1 de 002). Detrás del proxy del hosting, todas las peticiones
  tendrían la misma IP: los límites de los criterios 25 y 33 contarían a todos juntos y bloquearían la inscripción
  pública. Se resuelve al elegir el hosting (D-21), antes de publicar el formulario (T9).
- **Contadores en memoria por instancia** (PO-6 de 002): con varias instancias, cada límite vale por instancia.
- **El token en la dirección de la web:** D-27 fija `/a/{academia}/solicitud/{token}`; esa dirección queda en el
  historial del navegador y en los registros del servidor de la web o del proxy. Se mitiga con `no-referrer`, sin
  recursos de otros dominios y una vista mínima (criterios 32 y 44). Alternativa para el hosting: llevar el token tras
  `#`, que el navegador no envía.
- **Datos de solicitudes que nunca se pagaron:** quedan guardados (datos personales y médicos de personas que no llegaron
  a ser alumnas). Falta una política de retención y borrado (Ley 29733), que se define antes de producción.
- **Cifrado de los datos médicos:** se protegen con RLS, privilegios mínimos, vista mínima y sin registros; el cifrado en
  reposo depende del hosting (N7 b).
- **Textos legales provisionales:** los consentimientos y el deslinde llevan un texto genérico hasta que la academia
  los revise con un abogado (N7).
- **Foto sin dueño visible:** en esta historia nadie ve la foto; un error al guardarla solo se nota en la 008. Las
  pruebas del criterio 35 comprueban el archivo guardado.
- **Archivo huérfano:** si el proceso se cae entre guardar la foto nueva y confirmar, queda un archivo sin referencia que
  nadie puede leer (criterio 37). Una limpieza periódica queda para cuando haya proveedor de archivos.

## Decisiones

Propuestas del especificador; se aprueban con la spec.

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

## Preguntas abiertas

Las de negocio (N) son para Bryan; las técnicas (T), para el orquestador. Cada una lleva su propuesta y el valor
provisional con el que están escritos los criterios.

### De negocio

- **N1. ¿Cuánto dura la reserva del cupo antes de pagar?** Los documentos dicen que el cupo se reserva mientras el pago
  está pendiente de verificación, sin límite (RN-28), pero no dicen qué pasa entre que la persona envía el formulario y
  paga. **Propuesta:** el cupo queda reservado desde que envía el formulario y tiene **24 horas** para pagar (en
  recepción o subiendo el Yape, cuando exista la 007); si no paga, el cupo se libera solo y la solicitud queda
  "vencida". Cuando sube el comprobante, la reserva ya no vence hasta que la secretaria lo revise (RN-28). El valor es
  fijo en esta historia; si se quiere, se vuelve configurable por academia más adelante. _(Provisional: 24 horas;
  criterios 16 y 20.)_
- **N2. ¿Desde cuándo se cuentan las clases del cobro proporcional?** **Propuesta:** desde el momento en que envía el
  formulario; la clase de hoy cuenta solo si todavía no empezó. El monto queda fijo al enviar, aunque la secretaria
  verifique el pago días después. Y, siguiendo HU-34 al pie de la letra, quien se inscribe el día 1 en un mes que tiene
  menos clases que el plan (por ejemplo, 11 en vez de 12) paga la parte proporcional (11/12). _(Provisional así;
  criterios 8 y 9.)_
- **N3. ¿Se puede inscribir para el mes siguiente?** **Propuesta:** en esta historia, solo para el mes en curso. Si ya
  no quedan clases en el mes (por ejemplo, el último día por la noche), el formulario lo dice y pide volver el día 1.
  La inscripción para el mes siguiente llega con la renovación (010), que es la que respeta la prioridad de los alumnos
  actuales (D-06). _(Provisional así.)_
- **N4. ¿El horario es el mismo todos los días?** **Propuesta:** cada día elegido puede tener su propia hora, dentro de
  los días y horas que permite el plan, con una sola clase por día (por ejemplo, lunes a las 17:00 y miércoles a las
  18:00). _(Provisional así; criterio 15 b.)_
- **N5. ¿Qué datos son obligatorios?** **Propuesta:** obligatorios: nombres, apellidos, DNI, fecha de nacimiento,
  celular (9 dígitos, empieza con 9), nivel, plan y clases, tipo de sangre (con la opción "No sé"), contacto de
  emergencia (nombre y celular) y los dos consentimientos; para menores, además, nombres, apellidos, DNI, celular y
  parentesco (padre, madre u otro apoderado) del apoderado. Opcionales: correo (si se da, ahí llega el enlace),
  dirección, grado del colegio (lista de inicial a 5.° de secundaria, o "no estudia"), enfermedades, alergias,
  medicamentos, seguro, correo del apoderado y la foto. No pedimos sexo ni colegio (el modelo los menciona, pero HU-01
  no; menos datos es menos riesgo con la Ley 29733). Edad: de 0 a 100 años, sin mínimo. _(Provisional así; criterios
  12 y 13.)_
- **N6. ¿Qué pasa si el DNI ya está registrado?** **Propuesta:** se rechaza con un mismo mensaje ("Este DNI ya tiene una
  inscripción o solicitud en esta academia; usa tu enlace o acércate a recepción") si es de un alumno, de un cliente con
  una solicitud en curso o de alguien del personal. Si es de un cliente cuya solicitud anterior venció o fue cancelada,
  se acepta y se reemplazan sus datos. Ojo: este aviso, que pide HU-01, permite que cualquiera sepa si un DNI está en la
  academia; lo frenamos con límites por conexión. _(Provisional así; criterio 21.)_
- **N7. Consentimientos y textos legales.**
  - a) **Propuesta:** dos casillas obligatorias (tratamiento de datos personales, que menciona expresamente los datos de
    salud y de menores, y deslinde de responsabilidad) y una opcional de **uso de imagen** para las fotos y videos de
    progreso (la usará la 014; no marcarla no impide inscribirse). La foto del carnet queda cubierta por el tratamiento
    de datos. Si es menor, acepta el apoderado. Usaremos textos genéricos provisionales con el nombre de la academia;
    **antes de salir a producción, la academia debe revisarlos con un abogado.** _(Provisional así; criterio 14.)_
  - b) **Datos médicos:** **propuesta:** protegerlos con accesos por rol, sin mostrarlos en el seguimiento ni en los
    registros, y con el cifrado de disco del hosting; cifrado adicional por campo solo si el abogado lo pide.
- **N8. Límites contra el abuso.** **Propuesta:** como mucho **5 solicitudes sin pagar a la vez desde una misma
  conexión** (una familia con varios hijos entra; alguien que intenta llenar las clases, no), además de límites por
  minuto y por hora a cada pantalla pública. _(Provisional: 5; criterio 25.)_
- **N9. ¿Qué muestra el enlace de seguimiento y por cuánto tiempo?** **Propuesta:** solo el código, el estado, el primer
  nombre, el plan, los días y horas, el mes, las clases, el monto, la fecha límite de la reserva y el teléfono de la
  academia; nunca DNI, apellidos, salud, apoderado ni foto. El enlace no caduca; después de vencida o cancelada solo
  muestra ese estado. El cliente no puede cancelar desde el enlace: llama a la academia. _(Provisional así; criterio
  32.)_
- **N10. ¿Cómo inscribe la secretaria a quien llega a recepción?** **Propuesta:** con el mismo formulario público,
  abierto desde el panel ("Nueva inscripción"); la persona lee y acepta los consentimientos en la pantalla. El cobro en
  efectivo llega con la 007. Las solicitudes las ven y cancelan (con motivo) la secretaria y el administrador.
  _(Provisional así; criterios 38, 39 y 46.)_
- **N11. ¿Dividimos la historia?** Es grande: formulario, cupo, cobro, seguimiento, foto, panel y aforo con inscritos.
  **Propuesta:** dividirla en dos entregas:
  - **005a · Inscripción y reserva:** criterios 1 a 33, 41 a 45, 47 y 48 (tablas, oferta, cálculo, envío con el último
    cupo, seguimiento, límites, teléfono público, aforo con inscritos, web pública).
  - **005b · Foto y panel de solicitudes:** criterios 34 a 40 y 46 (`AlmacenArchivos`, `sharp` y la foto; lista,
    cancelación y ocupación en el panel).

  Las dos son de ruta crítica. _(Provisional: una sola historia, con este orden de tareas; si se divide, cada parte
  lleva sus pruebas protegidas y su ataque.)_

### Técnicas (para el orquestador)

- **T1. Foto en una segunda petición binaria** (`PUT` con `image/jpeg` o `image/png` y el token en `X-Token-Solicitud`),
  después de crear la solicitud, con un lector binario solo en esa ruta. Alternativas descartadas: la imagen en base64
  dentro del JSON (obliga a subir el límite de 100 KB de todo el cuerpo y suma un 33 %) y `multipart/form-data` (otro
  lector y otra superficie de ataque). _(Provisional así.)_
- **T2. Actor `PUBLICO` en la auditoría** para lo que hace un visitante sin cuenta (agrega un valor a `tipo_actor`).
  Alternativa: `SISTEMA` con el origen en `datosDespues` (sin migración del tipo, pero mezcla visitantes con tareas
  programadas). _(Provisional: `PUBLICO`.)_
- **T3. Clasificación:** críticos 1 a 10, 12 a 39, 41 y 42; prueba obligatoria 11, 40 y 43 a 46; revisor 47 y 48.
- **T4. `GET /api/a/{nombreCorto}` suma `telefono`** (cambia la forma del criterio 58 de 001 y su prueba protegida,
  solo para sumar). Alternativa: una ruta nueva para el teléfono (una petición más en cada página pública).
- **T5. Ocupación en una ruta aparte** (D8) y no en `claseSchema`.
- **T6. `sharp` como dependencia del backend** (D-25), con su binario por sistema operativo (la integración continua en
  Windows lo comprueba, D-26).
- **T7. Límites por IP del criterio 33** (60/min lecturas, 30/min cotización, 10/hora envío, 10/min consulta, 10/hora
  foto), en memoria como los de 002.
- **T8. El correo simulado no registra el destinatario ni el enlace** (criterio 27), aunque D-19 diga que "registra el
  mensaje": el enlace es una credencial y el registro técnico nunca lleva tokens (criterio 43 de 002). En desarrollo el
  enlace se ve en la respuesta y en la pantalla.
- **T9. `trust proxy`:** decidirlo con el hosting antes de publicar el formulario (riesgo "IP detrás de un proxy"). Sin
  eso, los límites por IP de esta historia bloquean a todos a la vez detrás de un proxy.
