# AquaGestión – Sistema de Gestión para Academia de Natación

Sistema web para una academia de natación en piscina semiolímpica (25 m): inscripción en línea, cobros y caja,
verificación de pagos por Yape o transferencia, carnet digital con QR, asistencia, mensualidades, rendimiento de
alumnos, facturación electrónica SUNAT y avisos de inasistencia por WhatsApp.

## Documentación

- [`docs/Documentacion_Sistema_Academia_Natacion.pdf`](docs/Documentacion_Sistema_Academia_Natacion.pdf): documento de requerimientos v1.4 (fuente de verdad).
- [`docs/requerimientos.md`](docs/requerimientos.md): el mismo contenido en texto, para buscar y consultar rápido.

## Stack sugerido (sección 8.4)

| Capa | Opción |
|---|---|
| Backend | Laravel (PHP) + Greenter para SUNAT |
| Frontend | React + Vite + Tailwind CSS (responsive, instalable como PWA) |
| Base de datos | PostgreSQL |
| Archivos | S3 / Cloudflare R2 / disco local del VPS |
| Mensajería | WhatsApp Business Platform (Cloud API de Meta) |
| Tareas | Laravel Scheduler + Queues |

## Fases

1. **MVP:** usuarios y roles, planes, clases y aforo, inscripción, pagos con verificación, carnet QR, asistencia,
   caja, mensualidades, cobro proporcional, SUNAT y aviso de inasistencia por WhatsApp.
2. **Gestión académica:** panel del entrenador, rendimiento, multimedia, clases particulares, descuentos,
   recuperaciones, días de cierre, pagos a entrenadores y asistencia fuera de horario.
3. **Inteligencia del negocio:** reportes exportables, dashboard, asistencia de profesores y auditoría avanzada.
4. **Extras:** más avisos por WhatsApp, PWA, QR dinámico y certificados.

## Puntos por aclarar antes de programar

1. El stack mezcla librerías de Node (`qrcode`, ExcelJS, PDFKit) con un backend en Laravel. En PHP las equivalentes
   son `simple-qrcode`, `maatwebsite/excel` y `dompdf` o `browsershot`.
2. HU-16 dice que la asistencia del entrenador sirve para "calcular sus pagos", pero RN-31 dice que el sistema no
   calcula sueldos.
3. No está definido el orden de cálculo del cobro: proporcional → redondeo → descuento → IGV. Si el redondeo va
   antes del IGV, el total ya no es un sol entero (S/ 88 + 18 % = S/ 103.84).
4. Un Yape enviado en línea fuera de horario: ¿a qué caja entra? RN-17 exige caja abierta para registrar cobros.
5. El cliente no tiene cuenta hasta que se confirma su pago: hace falta un enlace o código para que siga el estado
   de su solicitud.
6. HU-12 sigue "por confirmar" (prioridad para conservar el horario al renovar).
7. Faltan en el modelo de datos: tipo de asistencia (normal, recuperación, fuera de horario, particular),
   consentimientos (datos, imagen, WhatsApp) y el interruptor de avisos por alumno, desglose de IGV en `PAGO`,
   tabla de configuración (tolerancia, días "por vencer", régimen tributario), solicitud de cambio de nivel y
   bloqueo por intentos fallidos de inicio de sesión.
8. Dependencias externas que conviene tramitar ya: certificado digital y clave SOL para SUNAT, validación con el
   contador, cuenta Meta Business verificada y un número exclusivo para WhatsApp.
