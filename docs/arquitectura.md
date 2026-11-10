# Arquitectura de AquaGestión

Resumen técnico de las decisiones D-23 a D-30 de [`decisiones.md`](decisiones.md). Si algo de aquí contradice a
`decisiones.md`, manda `decisiones.md`.

## Vista general

Un solo sistema organizado por módulos, no microservicios. La web y la API se publican en el mismo dominio, así
la cookie de sesión puede ser estricta y no hace falta permitir el acceso desde otros dominios.

```
Navegador (PC de recepción / celular)
        │  mismo dominio:  /       → aplicación React
        │                  /api/*  → API NestJS
        ▼
   API NestJS ── Prisma ──► PostgreSQL (RLS por academia)
        ├── AlmacenArchivos  (disco local → luego S3/R2)
        ├── EnviadorCorreo   (log → luego proveedor)
        └── tareas programadas (faltas, cierre de mes)
```

## Varias academias

- Toda tabla del negocio lleva `academia_id`.
- La API toma la academia de la sesión del usuario, o del nombre corto de la dirección en las páginas públicas
  (`/a/{academia}/…`, D-27).
- Cada consulta corre dentro de una transacción que fija la academia (`set_config`), y PostgreSQL la vuelve a
  comprobar con seguridad a nivel de fila (RLS). Un error en una consulta no puede mostrar datos de otra academia.
- El DNI es único dentro de cada academia (D-28). El Superadmin administra las academias, pero no ve sus datos
  internos (D-29).

## Estructura de carpetas

```
piscina/
├── .claude/
│   ├── agents/                   Roles de la metodología
│   ├── hooks/preparar-sesion.mjs Prepara cada sesión en la nube
│   └── settings.json
├── .github/
│   ├── workflows/ci.yml          Revisión automática: Linux con PostgreSQL real + Windows
│   └── pull_request_template.md
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/           Incluyen las políticas RLS por academia
│   │   └── seed.ts               Datos inventados: 2 academias de ejemplo
│   ├── src/
│   │   ├── main.ts · app.module.ts
│   │   ├── comun/                Guards de rol, decorador de academia, filtros de error, dinero y fechas en Lima
│   │   ├── infraestructura/
│   │   │   ├── prisma/           Cliente que fija la academia en cada transacción (RLS)
│   │   │   ├── almacen-archivos/ Interfaz + disco local
│   │   │   ├── correo/           Interfaz + envío simulado (solo log)
│   │   │   └── reloj/            Hora actual inyectable, para probar bordes de horario
│   │   └── modulos/
│   │       ├── academias/        Alta de academias, Superadmin
│   │       ├── autenticacion/ · usuarios/ · auditoria/ · configuracion/
│   │       └── <modulo>/         Un módulo por área (planes, clases, caja, pagos, asistencia…)
│   │           ├── <modulo>.module.ts · .controller.ts · .service.ts
│   │           └── dominio/      Cálculos puros + sus pruebas unitarias (*.test.ts)
│   ├── test/
│   │   ├── integracion/<modulo>/ Pruebas contra PostgreSQL real
│   │   └── utilidades/           Crear academias y datos de prueba, limpiar la base
│   └── almacenamiento/           Archivos subidos en desarrollo (ignorado por git)
├── frontend/
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── rutas/                Rutas públicas, rutas por rol y protección por sesión
│       ├── modulos/<modulo>/     Páginas, componentes y hooks de cada área
│       ├── componentes/ui/       shadcn/ui
│       ├── componentes/          Compartidos: diseño, tablas, formularios
│       ├── api/                  Cliente HTTP + TanStack Query
│       └── lib/                  Formato de soles, fechas y horas de Lima
├── packages/contratos/src/       Esquemas zod y tipos, uno por módulo
├── e2e/                          Playwright: flujos críticos completos
├── scripts/                      En Node: verificar pruebas protegidas, crear bases, etc.
├── specs/
│   ├── _plantillas/
│   ├── backlog.md                Lista ordenada de historias
│   └── NNN-nombre/               spec.md · plan.md · tasks.md
├── docs/                         Requerimientos, decisiones, metodología, arquitectura, guía local para Windows
├── docker-compose.yml            Solo PostgreSQL, para la PC del responsable
├── .env.example                  Sin secretos
├── .gitattributes                Finales de línea LF
├── .nvmrc                        Node 22 LTS
├── package.json                  Workspaces y comandos comunes
├── CLAUDE.md
└── README.md
```

Las pruebas unitarias del dominio van junto al código; las de integración, en `backend/test/`, porque necesitan la
base de datos.

## Desarrollo en la nube y pruebas en Windows (D-26)

|               | Nube (sesiones de Claude)                                            | PC del responsable (Windows)         |
| ------------- | -------------------------------------------------------------------- | ------------------------------------ |
| PostgreSQL    | El instalado en el contenedor (no hay Docker)                        | `docker compose up -d`               |
| Configuración | `.env` con `DATABASE_URL`                                            | El mismo `.env`, con sus valores     |
| Al empezar    | `preparar-sesion.mjs`: enciende PostgreSQL, crea las bases de desarrollo y de pruebas, instala dependencias y aplica migraciones | `git pull` → `npm ci` → migraciones → `npm run dev` |

- Node 22 LTS en la nube, en la integración continua y en la PC (`.nvmrc` y `engines`).
- `.gitattributes` fija LF para que Windows no altere los archivos.
- La integración continua también instala y compila en Windows, porque Prisma, `sharp` y `@node-rs/argon2` traen
  binarios distintos por sistema operativo.
- `preparar-sesion.mjs` solo actúa en la nube; en la PC no hace nada.
