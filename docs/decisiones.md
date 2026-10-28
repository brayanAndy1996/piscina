# Registro de decisiones

Decisiones tomadas con el cliente sobre los "Puntos por aclarar" del README y sobre los cambios de requerimientos
posteriores al documento v1.4. Cuando una decisión contradice a `Documentacion_Sistema_Academia_Natacion.pdf`,
**manda esta decisión**.

Estados: ✅ aprobada · ⏳ pendiente de confirmar.

| # | Tema | Estado | Fecha |
|---|---|---|---|
| D-01 | Stack: backend en Node.js (TypeScript) | ✅ | 28/10/2026 |
| D-02 | El sistema no calcula sueldos | ✅ | 28/10/2026 |
| D-03 | Los precios ya incluyen IGV; orden de cálculo del cobro | ✅ | 28/10/2026 |
| D-04 | Caja a la que entra un Yape enviado fuera de horario | ✅ | 28/10/2026 |
| D-05 | Seguimiento de la solicitud del cliente | ✅ | 28/10/2026 |
| D-06 | Prioridad para conservar el horario al renovar (HU-12) | ✅ | 28/10/2026 |
| D-07 | Campos que faltan en el modelo de datos | ✅ | 28/10/2026 |
| D-08 | Se elimina WhatsApp; se amplía el panel del apoderado | ✅ | 28/10/2026 |
| D-09 | La facturación electrónica SUNAT pasa al último módulo | ✅ | 28/10/2026 |
| D-10 | Framework y librerías concretas de Node | ⏳ | — |
| D-11 | Tolerancia para considerar tardanza | ⏳ | — |
| D-12 | Escala de dominio por estilo | ⏳ | — |
| D-13 | Fase del panel del apoderado | ⏳ | — |

---

## D-01. Backend en Node.js

**Decisión:** el backend se desarrolla en **Node.js con TypeScript**, no en Laravel. Esto resuelve la mezcla de la
sección 8.4: las librerías de Node que sugería el documento (`qrcode`, ExcelJS, PDFKit) pasan a ser coherentes con el
backend.

Se mantienen PostgreSQL como base de datos y React + Vite + Tailwind CSS en el frontend.

**Consecuencia:** Greenter (PHP) deja de ser la opción para SUNAT. Como la facturación pasa al último módulo (D-09),
la forma de emitir se decide entonces.

## D-02. El sistema no calcula sueldos

**Decisión:** manda la RN-31. La asistencia de los entrenadores (HU-16) solo sirve para controlar la puntualidad
(reporte R6) y como referencia para el administrador. Se elimina de la HU-16 la frase "calcular sus pagos".

## D-03. Los precios ya incluyen IGV

**Decisión:** el precio del plan es el **monto final que paga el cliente** y ya incluye el IGV. El sistema no le
suma ni le resta nada. Un plan de S/ 100 se cobra S/ 100. Esto reemplaza a la RN-36 y a las respuestas Q19 y Q21.

**Orden de cálculo del cobro:**

1. Monto base = precio del plan (con IGV incluido).
2. Si la inscripción es a mitad de mes (RN-25):
   monto = precio_plan ÷ clases_por_mes × clases_restantes, **sin redondear todavía**.
3. Si el administrador ajusta el monto, el monto ajustado reemplaza al calculado (motivo obligatorio y auditoría).
4. Se aplica el código de descuento, si lo hay, sobre ese monto (HU-34). El monto nunca queda por debajo de cero.
5. El total se **redondea hacia arriba al sol entero**. Se redondea una sola vez, al final.

**Ejemplos:**

| Caso | Cálculo | Total |
|---|---|---|
| Plan S/ 100, mes completo | 100 | **S/ 100** |
| Plan S/ 100 de 12 clases, quedan 5 | 100 ÷ 12 × 5 = 41.67 | **S/ 42** |
| Lo anterior con 10 % de descuento | 41.67 × 0.90 = 37.50 | **S/ 38** |
| Plan S/ 210 de 12 clases, quedan 5 | 210 ÷ 12 × 5 = 87.50 | **S/ 88** |

**Pendiente para el módulo de facturación:** el comprobante de SUNAT exige mostrar el IGV por separado. Ese
desglose se calculará *desde* el total (valor de venta = total ÷ 1.18; IGV = total − valor de venta) solo al emitir
el comprobante, sin cambiar lo que paga el cliente. Hay que validarlo con el contador.

## D-04. Yape enviado fuera de horario

**Decisión:** un pago por Yape o transferencia enviado en línea se registra **sin caja**, en estado
`PENDIENTE_VERIFICACION`. Cuando la secretaria lo verifica, el pago **entra a la caja que esté abierta en ese
momento**. Verificar exige tener la caja abierta, igual que la RN-17.

El movimiento se registra con su método (Yape o transferencia), por lo que no suma al efectivo esperado del cierre.
Se guardan por separado la fecha de la operación (la del comprobante) y la fecha de verificación, para los reportes.

## D-05. Seguimiento de la solicitud del cliente

**Decisión:** al enviar el formulario de inscripción, el cliente recibe:

- un **código de solicitud** corto (por ejemplo `AQ-7F3K9`);
- un **enlace secreto** `/solicitud/{token}`, que también se envía por correo si lo registró.

Con el enlace, o con el código y su DNI, el cliente consulta el estado de su solicitud. Si su pago se rechaza, puede
subir un nuevo comprobante desde el mismo enlace, siempre que todavía haya cupo.

## D-06. Prioridad al renovar (HU-12)

**Decisión:** se confirma la prioridad con una regla configurable.

- Durante los últimos N días del mes (por defecto, los mismos 5 días de "por vencer"), el cupo de cada alumno
  vigente en su mismo horario queda **reservado para él** en el mes siguiente.
- Las inscripciones nuevas para el mes siguiente solo pueden usar los cupos libres.
- El día 1 se liberan los cupos reservados que nadie renovó.

## D-07. Campos que faltan en el modelo de datos

**Decisión:** se agregan al modelo de la sección 9:

- **Asistencia:** `tipo` (NORMAL, RECUPERACION, FUERA_HORARIO, PARTICULAR), `autorizado_por` y
  `estado_llegada` (PUNTUAL, TARDE; ver D-08).
- **Consentimientos:** tabla propia con tipo (DATOS_PERSONALES, IMAGEN, DESLINDE), fecha, IP y versión del texto
  aceptado, como evidencia para la Ley 29733. Ya no hay consentimiento de WhatsApp (D-08).
- **Pago:** `fecha_operacion` y la caja asignada al verificar (D-04). El número de operación no puede repetirse entre
  pagos pendientes o confirmados. Los campos de IGV se agregan con el módulo de facturación (D-03, D-09).
- **Configuración:** tabla clave/valor con la tolerancia de tardanza, los días "por vencer", los días de prioridad
  para renovar, el máximo de intentos de inicio de sesión y el tiempo de bloqueo.
- **Solicitud de cambio de nivel:** alumno, entrenador que la recomienda, nivel actual, nivel propuesto, estado y
  quién la resolvió (HU-21).
- **Usuario:** `intentos_fallidos`, `bloqueado_hasta` y `ultimo_acceso`, para bloquear tras varios intentos fallidos.
- **Solicitud de inscripción:** `codigo_solicitud` y `token_seguimiento` (D-05).

## D-08. Se elimina WhatsApp y se amplía el panel del apoderado

**Cambio de requerimientos:** **no se envían avisos por WhatsApp.** En su lugar, el apoderado consulta todo en el
panel.

**Se elimina:** la RN-34, la HU-42, la sección 8.5.1, el reporte R16, la tabla `NOTIFICACION_WHATSAPP`, el
consentimiento de WhatsApp y el interruptor de avisos por alumno. La HU-33 deja de usar WhatsApp: si se hace, los
avisos se muestran dentro del panel.

**Se mantiene:** el registro de faltas. Al terminar cada clase, más la tolerancia, el sistema registra la falta de los
alumnos que no marcaron asistencia, con las mismas excepciones de antes: día de cierre, asistencia en otro horario
autorizado o recuperación agendada a esa hora.

**Panel del apoderado:** según la RN-29, padres y alumno usan la misma cuenta, así que el panel del apoderado es la
cuenta del alumno. Ahí se ven:

- **Asistencia, día por día y con la hora de llegada:**
  - días que llegó **puntual**;
  - días que llegó **tarde**;
  - días que **faltó**;
  - totales del mes.
- **Progreso en natación:**
  - nivel actual (Básico, Intermedio o Avanzado);
  - dominio de cada estilo (crol, espalda, pecho y mariposa), por ejemplo "Mariposa: alto", "Pecho: bajo";
  - evolución mes a mes según las evaluaciones del entrenador (HU-21).

Para eso, cada asistencia guarda si fue puntual o tarde comparando la hora de llegada con la hora de inicio de la clase
más una tolerancia configurable (D-11).

## D-09. Facturación electrónica SUNAT al final

**Decisión:** la facturación electrónica (RN-26, HU-37, sección 8.5) sale de la Fase 1 y se desarrolla como **último
módulo** del proyecto. Mientras tanto, cada cobro genera solo un comprobante interno o ticket imprimible (HU-07).

Cuando llegue ese módulo se decidirá cómo emitir desde Node (generar y firmar el XML UBL 2.1 en el propio sistema o
usar un proveedor OSE/PSE). La emisión irá detrás de una interfaz `EmisorComprobantes`, para poder cambiar de
proveedor sin tocar el resto del sistema. Los trámites (certificado digital, clave SOL y validación con el contador)
pueden esperar hasta entonces.

## Pendientes de confirmar (propuestas)

- **D-10. Framework y librerías de Node.**
  - Backend: **NestJS** con **Prisma** como ORM y para las migraciones.
  - Autenticación: JWT en una cookie `httpOnly`, roles con guards de NestJS y contraseñas con argon2.
  - Tareas programadas: `@nestjs/schedule`.
  - Librerías: `qrcode` (QR), `pdfkit` (carnet, ticket y cierre de caja) y `exceljs` (reportes).
  - Frontend: `html5-qrcode` para leer el QR.
  - Repositorio: monorepo con npm workspaces (`backend/` y `frontend/`).
- **D-11. Tolerancia para considerar tardanza.** Llega **puntual** si marca asistencia hasta 10 minutos después
  de la hora de inicio de la clase, y **tarde** si marca después. El valor es configurable.
- **D-12. Escala de dominio por estilo.** **Bajo, Medio o Alto** por estilo, más "Sin evaluar". El nivel del alumno
  sigue siendo Básico, Intermedio o Avanzado, porque las clases se organizan por ese nivel.
- **D-13. Fase del panel del apoderado.**
  - En la Fase 1: la asistencia (puntual, tarde, faltas y horas) y el nivel actual, porque la asistencia ya es
    parte del MVP.
  - En la Fase 2: el dominio por estilo y la evolución, junto con las evaluaciones del entrenador (HU-21).
