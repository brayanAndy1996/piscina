# AquaGestión

Sistema web de gestión para academias de natación en Perú, pensado para varias academias en una misma instalación (piscina semiolímpica de 25 m): inscripción en línea,
cobros y caja, verificación de pagos por Yape o transferencia, carnet digital con QR, asistencia, mensualidades,
rendimiento de los alumnos y un panel de consulta para alumnos y apoderados.

Documentos de negocio, en este orden de prioridad:

1. [`docs/decisiones.md`](docs/decisiones.md): decisiones del responsable y cambios de requerimientos. **Manda sobre
   todo lo demás.** Por ejemplo: los precios ya incluyen IGV (D-03), no hay avisos por WhatsApp (D-08) y la
   facturación SUNAT es el último módulo (D-09).
2. [`docs/Documentacion_Sistema_Academia_Natacion.pdf`](docs/Documentacion_Sistema_Academia_Natacion.pdf):
   requerimientos v1.4 (HU, RN, RNF, modelo de datos).
3. [`docs/requerimientos.md`](docs/requerimientos.md): el mismo texto extraído del PDF, para buscar. Si una tabla
   perdió el formato, manda el PDF.

Ante cualquier duda de negocio, esos documentos mandan sobre la memoria o la intuición. Lo que no esté en ellos es
una pregunta abierta para el responsable, no una regla que se inventa.

La metodología completa está en [`docs/metodologia.md`](docs/metodologia.md).

## Tu rol en la sesión principal: orquestador

La conversación principal es el **orquestador**. No implementa funcionalidades grandes por su cuenta: elige la
historia, delega cada paso al subagente de su rol, integra los resultados y pide aprobación al responsable del
producto en los puntos marcados. Cada subagente trabaja con su propio contexto, así que el orquestador le pasa
todo lo que necesita: la ruta de la especificación, los archivos relevantes y qué se espera de vuelta.

El responsable del producto es Bryan. Comunícate con él en español.

| Rol           | Subagente        | Modelo     | Razonamiento |
| ------------- | ---------------- | ---------- | ------------ |
| Orquestador   | sesión principal | Opus 5.5   | alto         |
| Especificador | `especificador`  | Opus 5.5   | alto         |
| Adversarial   | `adversarial`    | Opus 5.5   | alto         |
| Backend       | `backend`        | Sonnet 5.5 | alto         |
| Frontend      | `frontend`       | Sonnet 5.5 | alto         |
| Test writer   | `test-writer`    | Sonnet 5.5 | alto         |
| Revisor       | `revisor`        | Sonnet 5.5 | alto         |
| Tester        | `tester`         | Haiku 5.5  | max          |
| Documentador  | `documentador`   | Haiku 5.5  | max          |

Los subagentes no lanzan otros subagentes: toda la coordinación pasa por el orquestador.

## Flujo de cada historia (SDD + TDD + pruebas adversariales)

1. **Especificación.** `especificador` escribe `specs/NNN-nombre/spec.md`, `plan.md` y `tasks.md` a partir de
   `specs/_plantillas/`, enlazando los requerimientos (HU, RN) y las decisiones (D-XX) que cubre.
2. **Aprobación.** El orquestador muestra un resumen con las preguntas abiertas y su propuesta para cada una, y
   espera la aprobación antes de que se escriba código.
3. **Clasificación.** Se marca en `spec.md` qué criterios son de **ruta crítica** (lista abajo).
4. **Solo ruta crítica, pruebas primero.** `test-writer` escribe las pruebas protegidas desde la especificación y
   los contratos públicos, sin mirar la implementación. `tester` confirma que fallan por la razón esperada.
   Commit: "Pruebas protegidas (NNN): … (en rojo)".
5. **Implementación.** `backend` y/o `frontend` implementan hasta que las pruebas pasen, sin modificar, borrar ni
   debilitar las pruebas protegidas.
6. **Solo ruta crítica, ataque.** `adversarial` recibe la especificación y el código, no el razonamiento de quien
   implementó. Por cada falla: el especificador agrega el criterio a `spec.md`, `test-writer` escribe la prueba
   protegida en rojo, se corrige y se vuelve a atacar. Las rondas siguen hasta que no haya fallas.
7. **Revisión.** `revisor` compara con la especificación y estas convenciones; `tester` ejecuta toda la suite, el
   lint y la verificación de tipos. Antes, el orquestador revisa con `git diff` que ningún commit de
   implementación haya tocado las pruebas protegidas.
8. **Cierre.** `documentador` hace el commit, marca las tareas y actualiza la documentación. El orquestador hace
   push, abre el PR hacia `main` y pide al responsable unirlo.

Las historias no críticas se saltan los pasos 4 y 6 y llevan solo las pruebas que el desarrollador considere
necesarias.

## Ruta crítica

Funciones donde un error cuesta dinero, problemas legales, filtración de datos o la confianza de la academia:

- **Aislamiento entre academias:** el sistema atiende a varias academias (D-23). Ningún usuario, consulta, archivo,
  tarea programada o enlace público puede leer ni modificar datos de otra academia. Se aplica en la API y se refuerza
  con seguridad a nivel de fila (RLS) en PostgreSQL.
- **Cálculo del cobro:** monto proporcional por inscripción a mitad de mes, ajuste del administrador, código de
  descuento y redondeo hacia arriba al sol entero, una sola vez y al final. Los precios ya incluyen IGV (RN-25,
  HU-34, D-03).
- **Pagos y verificación:** efectivo confirmado al instante; Yape o transferencia con comprobante, pendiente hasta
  que la secretaria lo apruebe o rechace; número de operación sin duplicados; paso de cliente a alumno con usuario
  y carnet solo con el pago confirmado (RN-01 a RN-05, RN-28, HU-04, HU-07 a HU-09, D-04).
- **Caja:** apertura, ingresos y egresos, cierre con esperado por método y diferencia, reapertura solo por el
  administrador; ningún cobro con la caja cerrada; un Yape entra a la caja abierta al momento de verificarlo
  (RN-17, HU-25 a HU-27, D-04).
- **Aforo y reservas:** nunca más inscritos que el aforo, aunque dos personas tomen el último cupo a la vez; el cupo
  queda reservado mientras el pago está pendiente; prioridad para conservar el horario al renovar (RN-11, RN-28,
  HU-02, HU-03, D-06).
- **Asistencia:** QR con un token aleatorio y no el DNI; rechazo si la mensualidad está vencida o no quedan clases;
  una asistencia por día; marcado solo mientras dura la clase; puntual hasta los 10 minutos configurables y tarde
  después; cada asistencia descuenta una clase; registro de faltas (RN-06, RN-14 a RN-16, HU-13 a HU-15, D-11,
  D-16).
- **Permisos y datos sensibles:** cada rol solo hace lo que permite la matriz de permisos (sección 2.1 de los requerimientos); el entrenador solo
  ve a sus alumnos; los datos médicos y de menores son sensibles (Ley 29733); el panel del alumno y del apoderado
  muestra solo a ese alumno y en solo lectura; la multimedia solo la ven el alumno, el administrador y el
  entrenador que la subió; auditoría de caja, pagos, cambios de horario y ajustes (RN-18 a RN-22, RNF-05, RNF-06,
  D-14).
- **Autenticación:** contraseña inicial igual al DNI con cambio obligatorio en el primer ingreso, bloqueo tras
  varios intentos fallidos, contraseñas con argon2 (RN-02, HU-05, RNF-03, RNF-04, D-07, D-10).
- **Entradas públicas:** formulario de inscripción, subida de comprobantes (JPG o PNG de hasta 5 MB) y enlace de
  seguimiento de la solicitud, que no se puede adivinar ni recorrer (HU-01, HU-08, D-05).
- **Facturación electrónica SUNAT,** cuando llegue su módulo, el último (D-09).

Fuera de la ruta crítica, por ejemplo: reportes y exportaciones, dashboard, mantenimiento simple de planes y
clases (salvo lo que toca el aforo), apariencia de las pantallas y certificados.

### Qué ataca el adversarial en AquaGestión

Además de la lista general de su rol:

- **Horas y fechas en America/Lima:** clases que empiezan o terminan en el borde de la ventana, la clase de 19:00 a
  20:00, cambios de día y de mes, servidores con otra zona horaria.
- **Aforo:** inscripciones, renovaciones, recuperaciones y cambios de horario simultáneos sobre el último cupo.
- **Pagos:** el mismo número de operación con espacios, ceros o mayúsculas distintas; aprobar dos veces; aprobar un
  pago rechazado; cobrar con la caja de otro día.
- **Aislamiento entre academias:** pedir o modificar datos de otra academia cambiando un id, un identificador de
  academia en la dirección, un token de seguimiento o un QR; listados, reportes, archivos y tareas programadas que
  mezclen academias; consultas que se salten la seguridad a nivel de fila.
- **Aislamiento entre alumnos:** un alumno o apoderado que pide datos, asistencia, evaluaciones o multimedia de otro
  alumno cambiando el id; un entrenador que pide la ficha de un alumno que no es suyo.
- **Enlace de seguimiento y QR:** tokens adivinables, enumerables o reutilizados después de regenerar el QR.

## Arquitectura y convenciones

- **Stack (D-01, D-10, D-25):**
  - Un solo sistema organizado por módulos; la web y la API en el mismo dominio (`/` y `/api`).
  - Backend: Node.js 22 LTS con TypeScript estricto, NestJS y Prisma, sobre PostgreSQL 16.
  - Contratos: esquemas zod en `packages/contratos/`, compartidos por la API y la web; OpenAPI generado desde ellos.
  - Autenticación: JWT en una cookie `httpOnly` con versión de token por usuario, roles con guards de NestJS y
    contraseñas con `@node-rs/argon2`; `helmet` y `@nestjs/throttler`.
  - Librerías: `date-fns` con `@date-fns/tz`, `sharp`, `qrcode`, `pdfkit`, `exceljs`, `pino` y `@nestjs/schedule`.
  - Frontend: React, Vite, TypeScript y Tailwind CSS; React Router, TanStack Query, React Hook Form, shadcn/ui y
    `html5-qrcode`.
  - Archivos y correo detrás de las interfaces `AlmacenArchivos` y `EnviadorCorreo` (D-19, D-21).
- **Módulos del backend:** controlador (entrada y validación), servicio (caso de uso, transacción y auditoría) y
  dominio (cálculos puros, sin base de datos, fáciles de probar).
- **Estructura:** monorepo con npm workspaces. La crea la historia `000-esqueleto`:
  - `backend/`: API de NestJS; `backend/prisma/` tiene el esquema y las migraciones.
  - `frontend/`: aplicación web de React.
  - `packages/contratos/`: esquemas y tipos compartidos.
  - `e2e/`: pruebas de Playwright.
  - `scripts/`: scripts del proyecto, escritos en Node.
  - `specs/`: una carpeta por historia, más `specs/_plantillas/`.
  - `docs/`: requerimientos, decisiones, metodología y guías.
- **Reglas que no se negocian:**
  - Toda tabla del negocio lleva `academia_id`, y toda consulta corre con la academia del usuario (D-23).
  - Los montos usan `Decimal` en la base y en el código, nunca `number` con coma flotante.
  - Las fechas y horas de negocio se calculan en la zona **America/Lima**, sin depender de la zona del servidor.
  - Las escrituras de cobro, verificación y asistencia son idempotentes: un doble clic o un reintento no duplica
    nada.
  - El aforo y la caja se modifican dentro de transacciones que evitan condiciones de carrera.
  - Toda operación de caja, verificación de pago, cambio de horario o ajuste de monto queda en auditoría: quién,
    cuándo y qué.
  - Los efectos secundarios (correos, archivos, PDFs) ocurren después de confirmar la transacción.
- **Idioma del código:** el dominio va en español (tablas, columnas, entidades, servicios); los términos del
  framework, en inglés. Tablas y columnas en `snake_case`.
- **Multiplataforma:** el responsable usa **Windows**. Los scripts del proyecto funcionan en Windows, Mac y Linux
  (sin `cp`, `rm` ni `mkdir -p` de Unix; se usa Node o herramientas como `cross-env`). La configuración local va
  en `.env`, nunca editando archivos versionados.
- **Desarrollo en la nube (D-26):** las sesiones de Claude trabajan en la nube, con el PostgreSQL del contenedor. El
  responsable prueba en su PC con Windows y PostgreSQL en Docker. Lo que funciona en la nube debe funcionar igual en
  Windows: misma versión de Node, finales de línea LF y la integración continua también en Windows.
- **Repositorio público:** nunca subir credenciales, certificados, archivos `.env` ni datos reales. Los datos de
  prueba y de ejemplo son inventados.

## Pruebas

- **Herramientas:** Vitest en todo el repositorio, `supertest` para la API y Playwright para E2E.
- **Unitarias** para el dominio puro: cálculo del cobro, ventana de asistencia (puntual, tarde o fuera de la
  clase), estados de la mensualidad.
- **Integración** de la API contra un PostgreSQL real, sin simular la base de datos, para todo lo crítico: permisos,
  pagos, caja, aforo y asistencia.
- **E2E con Playwright** para los flujos críticos completos, por ejemplo inscripción → verificación del pago →
  carnet → asistencia.
- La integración continua levanta un PostgreSQL real y ejecuta la suite, el lint y la verificación de tipos.
- Las pruebas protegidas llevan al inicio `// spec: NNN-nombre (pruebas protegidas)`.

## Git

- La rama principal solo tiene lo aprobado; cada historia se trabaja en su propia rama y entra por PR.
- Commits frecuentes, descriptivos y en español, con las líneas de atribución que indique la sesión. Si el trabajo
  es largo, commits de respaldo ("… (en curso)").
- Nunca reescribir historia publicada (`--force`) ni saltarse hooks.
