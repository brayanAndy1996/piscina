# AquaGestión – Sistema de Gestión para Academia de Natación

Sistema web para una academia de natación en piscina semiolímpica (25 m): inscripción en línea, cobros y caja,
verificación de pagos por Yape o transferencia, carnet digital con QR, asistencia, mensualidades, rendimiento de
alumnos, facturación electrónica SUNAT y avisos de inasistencia por WhatsApp.

## Documentación

- [`docs/Documentacion_Sistema_Academia_Natacion.pdf`](docs/Documentacion_Sistema_Academia_Natacion.pdf): documento de requerimientos v1.4 (fuente de verdad).
- [`docs/requerimientos.md`](docs/requerimientos.md): el mismo contenido en texto, para buscar y consultar rápido.

- [`docs/decisiones.md`](docs/decisiones.md): decisiones tomadas con el cliente y cambios de requerimientos posteriores
  al v1.4. **Cuando contradicen al documento, mandan las decisiones.**

## Stack (ver D-01 y D-10 en `docs/decisiones.md`)

| Capa | Opción |
|---|---|
| Backend | Node.js + TypeScript (NestJS + Prisma, por confirmar) |
| Frontend | React + Vite + Tailwind CSS (responsive, instalable como PWA) |
| Base de datos | PostgreSQL |
| Archivos | S3 / Cloudflare R2 / disco local del VPS |
| QR, PDF y Excel | `qrcode`, `pdfkit`, `exceljs`; lectura del QR con `html5-qrcode` |
| Tareas | Tareas programadas en el backend (registro de faltas) |

## Fases (ajustadas según `docs/decisiones.md`)

1. **MVP:** usuarios y roles, planes, clases y aforo, inscripción con seguimiento de la solicitud, pagos con
   verificación, carnet QR, asistencia (puntual, tarde, falta), caja, mensualidades, cobro proporcional y panel del
   apoderado con su asistencia.
2. **Gestión académica:** panel del entrenador, rendimiento y dominio por estilo en el panel del apoderado,
   multimedia, clases particulares, descuentos, recuperaciones, días de cierre, pagos a entrenadores y asistencia
   fuera de horario.
3. **Inteligencia del negocio:** reportes exportables, dashboard, asistencia de profesores y auditoría avanzada.
4. **Extras:** PWA, QR dinámico y certificados.
5. **Facturación electrónica SUNAT** (último módulo).

Se eliminó el aviso de inasistencia por WhatsApp (D-08). Los "Puntos por aclarar" de la revisión del documento v1.4
quedaron resueltos en `docs/decisiones.md`.
