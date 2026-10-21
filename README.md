# Academia de natación

Base ejecutable v0.1.0, 2026-10-21. Repositorio: [brayanAndy1996/piscina](https://github.com/brayanAndy1996/piscina).

Backend Node.js/Fastify con Sequelize/PostgreSQL, web Next.js y aplicación Android React Native/Expo independientes. Ya existen diagnóstico de API/BD, pantalla web y pantalla móvil con caché SQLite técnica. **Todavía no hay usuarios, alumnos, cobros, asistencia ni sincronización de negocio.**

## Requisitos

- Node.js **24.22.0** (rama 24, mínimo 24.13) y npm 11; versión de referencia en `.node-version` y `.nvmrc`. El instalador rechaza Node incompatible. No sustituir con Node 24.1.
- PostgreSQL 17 para comprobar conexión real. La base se verificó con instancia temporal 17.5; mantener el servidor actualizado antes de un despliegue.
- Desarrollo Android: Expo Go compatible con SDK 58 para exploración, o Android SDK/JDK compatibles con React Native para `expo run:android`. No se requiere SDK para tipos y bundle Hermes. No hay APK entregado ni dispositivo certificado todavía.

## Descargar e instalar

Clona el repositorio o descarga su ZIP y extrae todo en una carpeta. Desde esa raíz:

```powershell
node --version
npm --version
npm ci
Copy-Item .env.example .env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

No ejecutar las copias sobre configuraciones propias existentes. Editar `.env` con la conexión PostgreSQL local. Las variables de `apps/mobile/.env` son públicas: nunca incluir contraseñas ni conexiones PostgreSQL.

No depende de las carpetas de otros productos. `node_modules`, `.tools`, bases locales, `.env`, bundles y referencias internas de `docs/contexto/` no se publican.

## PostgreSQL de desarrollo

Usar una base dedicada, sin datos de clientes. Ejemplo manual en `psql` como administrador de tu instalación local (no ejecutar sobre producción):

```sql
CREATE ROLE piscina WITH LOGIN PASSWORD 'piscina_local';
CREATE DATABASE piscina_dev OWNER piscina;
```

Estos nombres coinciden con `.env.example`; no crean un usuario administrador de la aplicación. Cambiar la contraseña en instalaciones reales y no publicar `.env`. No ejecutar los comandos si ya existen rol/base: configura los existentes o crea otros dedicados.

```powershell
npm run db:check
```

Este comando solo comprueba conexión, no crea/modifica tablas. No hay migraciones ni seeds comerciales todavía; se incorporarán con el primer esquema de negocio. La aplicación no ejecuta `sequelize.sync`, no carga demos ni crea usuarios al arrancar.

## Ejecutar API y web

```powershell
npm run dev
```

API en `http://127.0.0.1:4000`; web en `http://127.0.0.1:3000`. También pueden iniciarse en terminales separadas con `npm run dev:api` y `npm run dev:web`.

- `/health/live` comprueba que la API responde, aun sin BD.
- `/health/ready` devuelve 200 con PostgreSQL disponible, o 503 sin exponer credenciales.
- La web consulta la API desde su servidor y muestra disponibilidad o error real.

Para ejecutar compilados: `npm run build`, después `npm run start:api` y `npm run start:web` en terminales separadas. Los scripts de raíz cargan `.env`; los servidores escuchan loopback por defecto. No hay despliegue público configurado.

## Ejecutar Android

En `apps/mobile/.env`, establecer `EXPO_PUBLIC_API_URL` según el dispositivo:

- Teléfono físico: IP LAN del equipo que ejecuta la API, por ejemplo `http://192.168.1.10:4000`. No usar `localhost`, que apuntaría al propio teléfono.
- Emulador Android estándar: `http://10.0.2.2:4000`.
- Distribución: URL HTTPS del backend; HTTP se permite solo en desarrollo local.

Para teléfono físico, poner `API_HOST=0.0.0.0` en `.env`, reiniciar API y usar una red local de desarrollo confiable. API y Metro deben ser accesibles desde el teléfono; no abrirlos a internet ni modificar el router como parte de estas instrucciones.

```powershell
npm run dev:mobile
```

Esto inicia Metro por LAN; abre el proyecto con un cliente Expo compatible. La pantalla permite comprobar la API y conservar el último resultado técnico con fecha. Mostrar una caché no demuestra conexión actual ni autorización offline. El almacenamiento real en Android se debe verificar en equipo.

Con SDK/JDK configurados, `npm run android --workspace @piscina/mobile` genera/ejecuta el proyecto Android local de desarrollo. Este comando no fue probado aquí: no hay SDK Android ni celular conectado. No confundir Expo Go o el bundle JavaScript con un APK de producción; la operación offline distribuida se verificará con un build instalable.

## Comprobaciones

```powershell
npm run check
npm run test:postgres
npm run smoke
```

`check`: lint, tipos de los tres componentes, 6 pruebas automáticas, build API/web y exportación Android Hermes. No necesita BD conectada. `test:postgres`: 2 pruebas con la BD dedicada configurada, sin modificar tablas. `smoke`: API compilada + PostgreSQL real + página web de producción; comprueba también la caída de API. Ejecutar después del build y con PostgreSQL disponible.

También existen `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` y `npm run build:mobile`. `build:mobile` genera un bundle en `apps/mobile/dist`, no un APK. El workflow de GitHub ejecuta instalación limpia, checks, integración PostgreSQL y smoke; no despliega servicios.

Las pruebas SQLite usan archivos temporales aislados. La inicialización técnica del móvil solo crea `diagnostic_cache`; no implementa cola, permisos o datos comerciales. Resultados y límites: [verificación de base](docs/06-verificacion-base.md).

## Documentación

- [Acuerdos y primera entrega](docs/01-acuerdos-entregas.md).
- [Operación offline y sincronización](docs/02-operacion-sincronizacion.md).
- [Documentación funcional](docs/03-documentacion-funcional.md).
- [Método de desarrollo](docs/04-metodo-desarrollo.md).
- [Contrato de diagnóstico](docs/05-contratos-base.md).
- [Stack y evidencia](docs/decisiones/001-stack.md).
- [Spec 001](docs/specs/001-base-ejecutable.md).

Las reglas de offline de negocio siguen siendo: un único celular designado hasta 24 horas; demás equipos online; conflictos según primera operación válida aceptada por nube. No están implementadas en esta pantalla diagnóstica.

## Siguiente funcionalidad

Acceso, ámbitos/permisos y registro del dispositivo autorizado, mediante spec propia antes del código sensible. Después planes/horarios, alumnos/inscripciones, cobros/cajas y asistencia/sincronización. Los detalles no resueltos se cierran en cada spec; no adelantar SUNAT, multimedia ni mensajería externa.
