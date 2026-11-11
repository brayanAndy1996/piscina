# AquaGestión · Sistema de gestión para academias de natación

Sistema web de gestión para academias de natación en Perú, pensado para varias academias en una misma instalación
(D-23): inscripción en línea, cobros y caja, verificación de pagos por Yape o transferencia, carnet digital con QR,
asistencia, mensualidades, rendimiento de los alumnos y un panel de consulta para alumnos y apoderados.

## Qué está construido

La historia **000 · Esqueleto** está en curso. Deja la base técnica sobre la que se construye el resto. Todavía no hay
funciones de negocio ni tablas: el sistema arranca, se conecta a PostgreSQL y las herramientas de calidad funcionan.

- **API** (NestJS, en `/api`):
  - `GET /api/salud`: responde 200 si la API y la base de datos responden, y 503 si la base no responde, en menos de
    3 segundos.
  - Errores con un formato común (`NO_ENCONTRADO`, `ERROR_INTERNO`), cabeceras de seguridad con `helmet` y sin CORS,
    porque la web y la API comparten dominio.
  - Registros en JSON, con los valores de cookies y credenciales ocultos. Valida la configuración al arrancar, sin
    mostrar valores.
  - Reloj inyectable (`RELOJ`) para controlar la hora en las pruebas.
- **Base de datos:** PostgreSQL 16 con Prisma. La migración inicial está vacía: no hay tablas de negocio todavía
  (D-17). Las tablas de academias, auditoría y configuración llegan con la 001, y las de usuarios, con la 002.
- **Web** (React, en `/`): la página de inicio muestra el título "AquaGestión" y el estado del sistema ("Sistema en
  línea", "Sin conexión con la base de datos", entre otros). Las rutas desconocidas muestran "Página no encontrada"
  con un enlace para volver al inicio.
- **Calidad y método:** Vitest, ESLint, Prettier, `husky` con `lint-staged`, verificación de pruebas protegidas y de
  secretos, hook de sesión para la nube (D-26) e integración continua en GitHub Actions: Linux con PostgreSQL real,
  Windows y pruebas protegidas.
- **Pruebas E2E** con Playwright: comprueban que la web abre y muestra "Sistema en línea".

La siguiente historia es la **001 · Academias y aislamiento** (ver [`specs/backlog.md`](specs/backlog.md)).

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

## Comandos principales

| Comando                                                                 | Qué hace                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                                                           | Enciende la API (puerto 3000), la web (puerto 5173) y la compilación de los contratos.         |
| `npm run build`                                                         | Compila contratos, API y web, en ese orden.                                                    |
| `npm test`                                                              | Todas las pruebas, incluidas las de integración con PostgreSQL.                                |
| `npm run test:unit`                                                     | Las pruebas que no necesitan base de datos.                                                    |
| `npm run e2e`                                                           | Pruebas E2E con Chromium (la primera vez, `npx playwright install chromium`).                  |
| `npm run lint`, `npm run typecheck`, `npm run format:check`            | ESLint, tipos de TypeScript y formato con Prettier.                                            |
| `npm run db:preparar`                                                   | Crea las bases de desarrollo y de pruebas que falten, aplica las migraciones y la semilla.     |
| `npm run db:migrar`, `npm run db:migrar:pruebas`                        | Aplica las migraciones pendientes a la base de desarrollo o a la de pruebas.                   |
| `npm run db:migracion`                                                  | Crea una migración nueva a partir de un cambio en el esquema de Prisma.                        |
| `npm run db:semilla`                                                    | Carga los datos de ejemplo (hoy no carga ninguno).                                             |
| `npm run verificar:pruebas-protegidas`, `npm run verificar:sin-secretos` | Verificaciones del método y de seguridad del repositorio.                                      |

## Cómo funciona

- **Un solo dominio:** la web está en `/` y la API en `/api` (D-25). En desarrollo, Vite reenvía `/api` a la API.
- **Configuración en `.env`:** es una copia de `.env.example`, con valores de desarrollo inventados. No se sube al
  repositorio (D-21).
- **Mismo sistema en dos lugares:** en la nube, las sesiones de Claude usan un PostgreSQL del contenedor, y un hook
  prepara el entorno al empezar. En la PC del responsable, PostgreSQL corre en Docker (D-18, D-26). En ambos casos se
  usa `DATABASE_URL`.
- **Cómo se trabaja:** cada historia tiene su carpeta `specs/NNN-nombre/` (especificación, plan y tareas) y entra al
  proyecto por pull request. Las pruebas protegidas (`// spec: NNN-nombre (pruebas protegidas)`) solo cambian en sus
  propios commits, y la CI lo verifica en cada pull request. Detalles en [`docs/metodologia.md`](docs/metodologia.md).
- **Varias academias:** cada tabla de negocio llevará `academia_id`, y PostgreSQL filtrará por academia con seguridad a
  nivel de fila (D-23). Eso empieza en la 001.

## Estructura

```
piscina/
├── backend/              API en NestJS; backend/prisma/ tiene el esquema y las migraciones
├── frontend/             Web en React, con Vite y Tailwind CSS
├── packages/contratos/   Esquemas zod y tipos que comparten la API y la web
├── e2e/                  Pruebas E2E con Playwright
├── scripts/              Scripts en Node: bases de datos y verificaciones
├── eslint/               Regla de ESLint que obliga a usar RELOJ
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
- [`docs/guia-local-windows.md`](docs/guia-local-windows.md): cómo levantar el sistema en Windows, paso a paso.

## Forma de trabajo

El proyecto se desarrolla con especificación primero (SDD), pruebas primero en la ruta crítica (TDD), pruebas
adversariales y roles separados. Ver [`docs/metodologia.md`](docs/metodologia.md).

- [`CLAUDE.md`](CLAUDE.md): instrucciones del orquestador, ruta crítica, arquitectura y convenciones.
- [`.claude/agents/`](.claude/agents): los roles (especificador, adversarial, backend, frontend, test-writer,
  revisor, tester y documentador).
- [`docs/arquitectura.md`](docs/arquitectura.md): arquitectura y estructura de carpetas.
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
