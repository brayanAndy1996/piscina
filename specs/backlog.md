# Lista de historias

Orden de desarrollo aprobado por el responsable (D-30). El MVP incluye las Fases 1 y 2 (D-13). Cada historia se
especifica en `specs/NNN-nombre/` antes de programarla; las notas de esta lista son el punto de partida del
especificador, no la especificación.

Estados: ⬜ pendiente · 🟨 en curso · ✅ unida a `main`.

## Fase 1: operación básica

| N.º | Historia | Ruta crítica | Estado |
| --- | --- | --- | --- |
| 000 | Esqueleto | No | 🟨 |
| 001 | Academias y aislamiento | Sí | ⬜ |
| 002 | Autenticación y roles por academia | Sí | ⬜ |
| 003 | Configuración de la academia | No | ⬜ |
| 004 | Planes y clases con aforo | En parte | ⬜ |
| 005 | Inscripción pública y seguimiento de la solicitud | Sí | ⬜ |
| 006 | Caja | Sí | ⬜ |
| 007 | Pagos, verificación y paso de cliente a alumno | Sí | ⬜ |
| 008 | Carnet digital con QR | En parte | ⬜ |
| 009 | Asistencia y faltas | Sí | ⬜ |
| 010 | Mensualidades y renovación | En parte | ⬜ |
| 011 | Panel del alumno y apoderado: asistencia y nivel | Sí | ⬜ |

### Notas

- **000 · Esqueleto.** Monorepo con npm workspaces (`backend/`, `frontend/`, `packages/contratos/`, `e2e/`,
  `scripts/`) según [`docs/arquitectura.md`](../docs/arquitectura.md). NestJS y React que arrancan, Prisma conectado
  a PostgreSQL, Vitest, ESLint, Prettier, `husky` con `lint-staged`. `docker-compose.yml` con PostgreSQL,
  `.env.example`, `.gitattributes`, `.nvmrc` (Node 22). `.claude/hooks/preparar-sesion.mjs` para la nube (D-26).
  GitHub Actions en Linux con PostgreSQL real y en Windows. Script `scripts/verificar-pruebas-protegidas.mjs` en la
  integración continua: falla si un commit que no es de pruebas protegidas modifica un archivo marcado como tal.
  Guía para levantar el sistema en Windows (`docs/guia-local-windows.md`). Sin tablas de negocio (D-17).
- **001 · Academias y aislamiento.** Tabla de academias con nombre corto (D-27), `academia_id` y RLS, cliente de
  Prisma que fija la academia en cada transacción, Superadmin que crea y suspende academias y su primer
  administrador (D-23, D-29). Tablas transversales: auditoría y configuración por academia.
- **002 · Autenticación y roles.** Inicio de sesión por academia (`/a/{academia}/ingresar`), roles Admin,
  Secretaria, Entrenador y Alumno, DNI único por academia (D-28), contraseña inicial igual al DNI con cambio
  obligatorio, bloqueo por intentos, restablecimiento por la secretaria, matriz de permisos (RN-02, RN-03, HU-05,
  RNF-03, RNF-04).
- **003 · Configuración.** Tolerancia de tardanza (D-11), días "por vencer", días de prioridad al renovar (D-06),
  intentos de inicio de sesión, identidad de la academia (D-22).
- **004 · Planes y clases.** Planes (HU-19, RN-07) y clases por nivel, día, hora y entrenador, con aforo de 20 a 50
  (HU-17, RN-09 a RN-11). Lo crítico: el aforo.
- **005 · Inscripción pública.** Formulario con datos, ficha médica, apoderado y consentimientos (HU-01, RN-20,
  D-07), elección de días y horario con cupo (HU-02), foto opcional (D-20, D-24), código y enlace de seguimiento
  (D-05), cálculo del cobro proporcional (HU-34, RN-25, D-03).
- **006 · Caja.** Apertura, movimientos, egresos, cierre con esperado por método y diferencia, reapertura por el
  administrador, PDF del cierre (HU-25 a HU-27, RN-17).
- **007 · Pagos y verificación.** Efectivo, Yape y transferencia con comprobante, bandeja de verificación, número de
  operación sin duplicados, caja al verificar (D-04), paso de cliente a alumno con usuario (HU-04, HU-07 a HU-09,
  RN-01, RN-04, RN-28), ticket interno (D-09).
- **008 · Carnet QR.** Token aleatorio, regeneración que invalida el anterior, carnet en pantalla y en PDF, "Foto
  pendiente" (HU-13, RN-05, RN-06, D-24).
- **009 · Asistencia y faltas.** QR y manual, validaciones, una por día, solo mientras dura la clase, puntual o
  tarde, descuento de clase, registro de faltas por tarea programada (HU-14, HU-15, RN-14 a RN-16, D-08, D-11,
  D-16).
- **010 · Mensualidades.** Estados al día, por vencer, vencido y pendiente (HU-11), renovación con prioridad de
  horario (HU-12, D-06), cierre de mes y clases no usadas (RN-23), cambio de horario por la secretaria (HU-03,
  RN-08).
- **011 · Panel del alumno y apoderado.** Datos, plan, horario, clases restantes, vencimiento, asistencia día por
  día con hora (puntual, tarde, falta), nivel actual; solo lectura salvo el cambio de contraseña (HU-06, D-08, D-14).

## Fase 2: gestión académica

| N.º | Historia | Ruta crítica | Estado |
| --- | --- | --- | --- |
| 012 | Panel del entrenador y ficha del alumno | En parte | ⬜ |
| 013 | Evaluaciones, nivel por estilo y cambio de nivel | En parte | ⬜ |
| 014 | Multimedia por alumno y mes | En parte | ⬜ |
| 015 | Códigos de descuento | Sí | ⬜ |
| 016 | Clases particulares | En parte | ⬜ |
| 017 | Días de cierre y recuperación | En parte | ⬜ |
| 018 | Clases recuperables y agenda de recuperación | En parte | ⬜ |
| 019 | Pagos a entrenadores | En parte | ⬜ |
| 020 | Asistencia autorizada en otro horario | En parte | ⬜ |

### Notas

- **012:** HU-18, HU-20, RN-18, RN-21. Lo crítico: el entrenador solo ve a sus alumnos.
- **013:** HU-21, D-12, D-15; el progreso por estilo y la evolución se agregan al panel del apoderado (D-13).
- **014:** HU-22, RN-19; consentimiento de imagen. Lo crítico: quién ve cada archivo.
- **015:** HU-10, RN-12; se aplica sobre el monto proporcional (D-03).
- **016:** HU-23, HU-24, RN-13. Lo crítico: el cobro.
- **017:** HU-41, RN-33.
- **018:** HU-35, HU-36, RN-23, RN-24. Lo crítico: aforo y descuento de clases recuperables.
- **019:** HU-39, RN-31, RN-35, D-02. Lo crítico: el egreso de caja.
- **020:** HU-38, RN-30. Lo crítico: aforo y descuento del plan.

## Después del MVP

- **Fase 3:** reportes exportables, dashboard, asistencia de entrenadores (D-02) y auditoría avanzada.
- **Fase 4:** PWA, QR dinámico y certificados.
- **Último módulo:** facturación electrónica SUNAT (D-09), por academia (D-23).
