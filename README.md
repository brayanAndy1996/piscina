# AquaGestión · Sistema de gestión para academias de natación

Sistema web de gestión para academias de natación en Perú, pensado para varias academias en una misma instalación
(D-23): inscripción en línea, cobros y caja, verificación de pagos por Yape o transferencia, carnet digital con QR,
asistencia, mensualidades, rendimiento de los alumnos y un panel de consulta para alumnos y apoderados.

## Qué está construido

**000 · Esqueleto** está unida a `main` y deja la base técnica:

- **API** (NestJS, en `/api`):
  - `GET /api/salud`: responde 200 si la API y la base de datos responden, y 503 si la base no responde, en menos de
    3 segundos.
  - Errores con un formato común (`NO_ENCONTRADO`, `ERROR_INTERNO`), cabeceras de seguridad con `helmet` y sin CORS,
    porque la web y la API comparten dominio.
  - Registros en JSON, con los valores de cookies y credenciales ocultos. Valida la configuración al arrancar, sin
    mostrar valores.
  - Reloj inyectable (`RELOJ`) para controlar la hora en las pruebas.
- **Web** (React, en `/`): la página de inicio muestra el título "AquaGestión" y el estado del sistema ("Sistema en
  línea", "Sin conexión con la base de datos", entre otros). Las rutas desconocidas muestran "Página no encontrada"
  con un enlace para volver al inicio.
- **Calidad y método:** Vitest, ESLint, Prettier, `husky` con `lint-staged`, verificación de pruebas protegidas y de
  secretos, hook de sesión para la nube (D-26) e integración continua en GitHub Actions: Linux con PostgreSQL real,
  Windows y pruebas protegidas.
- **Pruebas E2E** con Playwright: comprueban que la web abre y muestra "Sistema en línea".

**001 · Academias y aislamiento** está construida y espera la aprobación del responsable para unirse a `main`. Trae:

- **Academias:** cada academia tiene un nombre y un nombre corto (de 3 a 30 caracteres, en minúsculas, que no se puede
  cambiar; D-27). La plataforma la crea, la lista, la suspende con un motivo obligatorio y la reactiva. Una academia
  suspendida conserva sus datos.
- **Superadmin:** su cuenta se crea, y su clave se restablece, con `npm run plataforma:superadmin`; no hay registro por
  la web (D-29). Inicia sesión en `/plataforma/ingresar`, con una cookie `httpOnly` de 8 horas. Cinco intentos fallidos
  seguidos bloquean la cuenta 15 minutos, y hay un límite de 10 intentos por minuto desde una misma IP.
- **Aislamiento entre academias:** la API se conecta con el rol `aquagestion_app`, sin superusuario ni `BYPASSRLS`.
  PostgreSQL filtra las tablas por academia con seguridad a nivel de fila (RLS), también para el dueño de las tablas.
  Cada transacción fija la academia o el contexto de plataforma, y si el rol no es seguro, la API no atiende datos.
  Detalles en [`docs/arquitectura.md`](docs/arquitectura.md).
- **Auditoría:** las altas, suspensiones y reactivaciones de academias, y el alta y el restablecimiento del superadmin,
  quedan en la auditoría de la plataforma. Los inicios de sesión van solo al registro técnico. Todavía no hay pantalla
  para verla.
- **Configuración:** la tabla de configuración por academia existe, sin claves todavía (las define la 003).
- **Ruta pública:** `GET /api/a/{nombreCorto}` devuelve el nombre de una academia activa, sin su id ni su estado. Responde
  404 si no existe y 403 si está suspendida.
- **Datos de ejemplo:** `npm run db:semilla` (y `npm run db:preparar`) crea, si no existen, las academias `delfines`
  ("Academia de Natación Los Delfines") y `tiburones` ("Club de Natación Tiburones") y el superadmin de desarrollo.
- **Web:** `/plataforma/ingresar` y `/plataforma/academias`, para crear, suspender y reactivar academias y para cerrar
  sesión. `/plataforma` lleva a la lista.

Todavía no existen los usuarios de las academias ni su inicio de sesión: el primer administrador de cada academia lo crea
la 002 (DR-1).

La siguiente historia es la **002 · Autenticación y roles por academia** (ver [`specs/backlog.md`](specs/backlog.md)).

## Cómo levantarlo en Windows

La guía paso a paso, escrita para quien no es experto, está en
[`docs/guia-local-windows.md`](docs/guia-local-windows.md).

Requisitos: Git para Windows, Node.js 22 (22.22.3 o más reciente de la rama 22) y Docker Desktop. En PowerShell, dentro
de la carpeta del proyecto:

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

`Copy-Item` y `npm run db:preparar` solo hacen falta la primera vez. Luego abre http://localhost:5173: debe aparecer
**Sistema en línea**.

Si ya tenías el proyecto antes de la historia 001, no vuelvas a copiar `.env.example`: ejecuta `npm ci` y
`npm run env:completar` (agrega las variables nuevas a tu `.env`), y después `npm run db:preparar`. Los pasos completos
están en la guía, en "Después de traer la historia 001".

## Comandos principales

| Comando                                                                 | Qué hace                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                           | Enciende la API (puerto 3000), la web (puerto 5173) y la compilación de los contratos.                            |
| `npm run build`                                                         | Compila contratos, API y web, en ese orden.                                                                       |
| `npm test`                                                              | Todas las pruebas, incluidas las de integración con PostgreSQL.                                                   |
| `npm run test:unit`                                                     | Las pruebas que no necesitan base de datos.                                                                       |
| `npm run e2e`                                                           | Pruebas E2E con Chromium (la primera vez, `npx playwright install chromium`).                                     |
| `npm run lint`, `npm run typecheck`, `npm run format:check`            | ESLint, tipos de TypeScript y formato con Prettier.                                                               |
| `npm run db:preparar`                                                   | Crea el rol `aquagestion_app` y las bases de desarrollo y de pruebas que falten, aplica las migraciones y la semilla. |
| `npm run db:crear`                                                      | Crea solo el rol `aquagestion_app` y las bases que falten (lo usa `db:preparar`).                                 |
| `npm run db:migrar`, `npm run db:migrar:pruebas`                        | Aplica las migraciones pendientes a la base de desarrollo o a la de pruebas.                                      |
| `npm run db:migracion`                                                  | Crea una migración nueva a partir de un cambio en el esquema de Prisma.                                           |
| `npm run db:semilla`                                                    | Crea las academias de ejemplo y el superadmin de desarrollo, si no existen.                                       |
| `npm run env:completar`                                                 | Agrega a `.env` las variables de `.env.example` que falten, sin cambiar las que ya tienes.                        |
| `npm run plataforma:superadmin`                                         | Crea el superadmin de la plataforma o le restablece la clave, con `SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE`. |
| `npm run verificar:pruebas-protegidas`, `npm run verificar:sin-secretos` | Verificaciones del método y de seguridad del repositorio.                                                         |

## Cómo funciona

- **Un solo dominio:** la web está en `/` y la API en `/api` (D-25). En desarrollo, Vite reenvía `/api` a la API.
- **Configuración en `.env`:** es una copia de `.env.example`, con valores de desarrollo inventados. No se sube al
  repositorio (D-21).
- **Dos conexiones a la base:** la API se conecta con `DATABASE_URL_APP`, que es el rol `aquagestion_app` y está sujeto
  a la seguridad por academia. Las migraciones, la semilla y los comandos usan `DATABASE_URL`, que es el dueño de las
  tablas.
- **Mismo sistema en dos lugares:** en la nube, las sesiones de Claude usan un PostgreSQL del contenedor, y un hook
  prepara el entorno al empezar. En la PC del responsable, PostgreSQL corre en Docker (D-18, D-26).
- **Cómo se trabaja:** cada historia tiene su carpeta `specs/NNN-nombre/` (especificación, plan y tareas) y entra al
  proyecto por pull request. Las pruebas protegidas (`// spec: NNN-nombre (pruebas protegidas)`) solo cambian en sus
  propios commits, y la CI lo verifica en cada pull request. Detalles en [`docs/metodologia.md`](docs/metodologia.md).
- **Varias academias:** cada tabla de negocio lleva `academia_id`, y PostgreSQL filtra por academia con seguridad a nivel
  de fila (D-23). Eso ya está en la 001. Las reglas de fechas, transacciones y errores que siguen las historias nuevas
  están en [`docs/arquitectura.md`](docs/arquitectura.md).

## Estructura

```
piscina/
├── backend/              API en NestJS; backend/prisma/ tiene el esquema y las migraciones
├── frontend/             Web en React, con Vite y Tailwind CSS
├── packages/contratos/   Esquemas zod y tipos que comparten la API y la web
├── e2e/                  Pruebas E2E con Playwright
├── scripts/              Scripts en Node: bases de datos y verificaciones
├── eslint/               Reglas de ESLint del proyecto (uso de RELOJ, acceso a la base y SQL)
├── specs/                Una carpeta por historia, backlog.md y _plantillas/
├── docs/                 Requerimientos, decisiones, metodología, arquitectura y guía de Windows
├── .claude/              Roles de la metodología y hook de sesión para la nube
├── .github/              CI (workflows/ci.yml) y plantilla de pull request
├── .husky/               Hooks de git: pre-commit y commit-msg
├── docker-compose.yml    PostgreSQL 16 para la PC
└── .env.example          Variables de configuración: copiar a .env
```

La arquitectura objetivo (módulos, aislamiento entre academias, archivos y correo) está en
[`docs/arquitectura.md`](docs/arquitectura.md).

## Documentación

- [`docs/Documentacion_Sistema_Academia_Natacion.pdf`](docs/Documentacion_Sistema_Academia_Natacion.pdf): documento de requerimientos v1.4 (fuente de verdad).
- [`docs/requerimientos.md`](docs/requerimientos.md): el mismo contenido en texto, para buscar y consultar rápido.
- [`docs/decisiones.md`](docs/decisiones.md): decisiones tomadas con el cliente y cambios de requerimientos posteriores
  al v1.4. **Cuando contradicen al documento, mandan las decisiones.**
- [`docs/guia-local-windows.md`](docs/guia-local-windows.md): cómo levantar el sistema en Windows, paso a paso, y cómo
  entrar a la plataforma.

## Forma de trabajo

El proyecto se desarrolla con especificación primero (SDD), pruebas primero en la ruta crítica (TDD), pruebas
adversariales y roles separados. Ver [`docs/metodologia.md`](docs/metodologia.md).

- [`CLAUDE.md`](CLAUDE.md): instrucciones del orquestador, ruta crítica, arquitectura y convenciones.
- [`.claude/agents/`](.claude/agents): los roles (especificador, adversarial, backend, frontend, test-writer,
  revisor, tester y documentador).
- [`docs/arquitectura.md`](docs/arquitectura.md): arquitectura, aislamiento entre academias, fechas y horas de Lima, y
  reglas para las historias siguientes.
- [`specs/backlog.md`](specs/backlog.md): la lista ordenada de historias.
- [`specs/`](specs): una carpeta por historia (`spec.md`, `plan.md`, `tasks.md`), a partir de
  `specs/_plantillas/`.

## Stack (ver D-01 y D-10 en `docs/decisiones.md`)

| Capa | Opción |
|---|---|
| Backend | Node.js 22 + TypeScript con NestJS y Prisma |
| Frontend | React + Vite + Tailwind CSS (responsive; la PWA es de la Fase 4) |
| Base de datos | PostgreSQL 16 |
| Archivos | Disco local en desarrollo, detrás de una interfaz `AlmacenArchivos` (se implementa en la 005); el proveedor se decide con el hosting (D-21) |
| QR, PDF y Excel | `qrcode`, `pdfkit`, `exceljs`; lectura del QR con `html5-qrcode` |
| Tareas | Tareas programadas en el backend (registro de faltas) |

Las librerías de negocio se agregan con la historia que las usa.

## Fases (ajustadas según `docs/decisiones.md`)

El producto mínimo viable (MVP) incluye las Fases 1 y 2 (D-13).

1. **Operación básica:** usuarios y roles, planes, clases y aforo, inscripción con seguimiento de la solicitud, pagos con
   verificación, carnet QR, asistencia (puntual, tarde, falta), caja, mensualidades, cobro proporcional y panel del
   apoderado con su asistencia.
2. **Gestión académica:** panel del entrenador, rendimiento y nivel por estilo en el panel del apoderado,
   multimedia, clases particulares, descuentos, recuperaciones, días de cierre, pagos a entrenadores y asistencia
   fuera de horario.
3. **Inteligencia del negocio:** reportes exportables, dashboard, asistencia de profesores y auditoría avanzada.
4. **Extras:** PWA, QR dinámico y certificados.
5. **Facturación electrónica SUNAT** (último módulo).

Los "Puntos por aclarar" de la revisión del documento v1.4 y los cambios posteriores quedaron resueltos en
`docs/decisiones.md`, que manda sobre el documento.
