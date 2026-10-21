# Academia de natación

Acceso y dispositivo v0.2.0, 2026-10-21. Repositorio: [brayanAndy1996/piscina](https://github.com/brayanAndy1996/piscina).

Backend Node.js/Fastify con Sequelize/PostgreSQL, web Next.js y aplicación Android React Native/Expo independientes. Incluye usuarios/roles, sesiones revocables, auditoría, pantallas web/Android y autorización firmada del único celular offline. **Todavía no hay alumnos, cobros, asistencia ni sincronización de negocio.**

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

Este comando solo comprueba conexión, no crea/modifica tablas. Existen migraciones y demo opcional de acceso; los datos comerciales de alumnos/cobros llegarán después. La aplicación no ejecuta `sequelize.sync`, no carga demos ni crea usuarios al arrancar. Las migraciones y demo de acceso se ejecutan explícitamente; ver preparación a continuación.

## Preparar acceso

Después de configurar `.env` y PostgreSQL:

```powershell
npm run keys:generate
npm run db:migrate
```

La clave privada queda en `.env.keys` (ignorada por Git y sin sobrescribir). Copia solo la clave pública mostrada a `EXPO_PUBLIC_OFFLINE_PUBLIC_KEY` en `apps/mobile/.env`. Configura `WEB_ORIGIN=http://127.0.0.1:3000` para desarrollo; en producción debe ser el origen HTTPS público exacto.

Completa los campos BOOTSTRAP_* de `.env` con la academia, usuario y contraseña propios; ejecuta `npm run users:bootstrap` y retira la contraseña de bootstrap del archivo. No hay administrador predeterminado. Para escenarios ficticios existe `npm run db:seed:demo`, únicamente tras migrar una BD dedicada `_demo`; no ejecutarlo sobre instalaciones reales.

[Guía completa de acceso, demo, recuperación y contratos](docs/07-acceso-dispositivo.md).

## Ejecutar API y web

```powershell
npm run dev
```

API en `http://127.0.0.1:4000`; web en `http://127.0.0.1:3000`. También pueden iniciarse en terminales separadas con `npm run dev:api` y `npm run dev:web`.

- `/health/live` comprueba que la API responde, aun sin BD.
- `/health/ready` devuelve 200 con PostgreSQL disponible, o 503 sin exponer credenciales.
- La web consulta la API desde su servidor y muestra disponibilidad o error real.
- `/acceso` permite login, usuarios/roles, dispositivos y auditoría según permisos. Tokens en cookie HttpOnly, no en localStorage.

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

Esto inicia Metro por LAN; abre el proyecto con un cliente Expo compatible. La pantalla principal permite login, cambio de contraseña, usuarios para administrador, registro/designación del equipo y sincronización de acceso firmado. Diagnóstico conserva su pantalla separada. Expo Go permite acceso online; **el permiso offline necesita el módulo de reloj propio y un build Android nativo**. SecureStore/reloj deben comprobarse en teléfono real antes de certificarlo.

Con SDK/JDK configurados, `npm run android --workspace @piscina/mobile` genera/ejecuta el proyecto Android local de desarrollo. Este comando no fue probado aquí: no hay SDK Android ni celular conectado. No confundir Expo Go o el bundle JavaScript con un APK de producción; la operación offline distribuida se verificará con un build instalable.

## Comprobaciones

```powershell
npm run check
npm run test:postgres
npm run smoke
npm run smoke:access
```

`check`: lint, tipos de los tres componentes, 13 pruebas automáticas, build API/web y exportación Android Hermes. No necesita BD conectada. `test:postgres`: pruebas de PostgreSQL y acceso con fixtures propios. Requiere API_TEST_DATABASE_URL local con BD `_test` y rol de pruebas con CREATEDB; crea/elimina únicamente esquemas/bases efímeros. No usa la conexión operativa como fallback. `smoke`: API compilada + PostgreSQL real + página web de producción; comprueba también la caída de API. Ejecutar después del build y con PostgreSQL disponible.

También existen `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` y `npm run build:mobile`. `build:mobile` genera un bundle en `apps/mobile/dist`, no un APK. `npm run smoke:access` verifica BFF y administración en navegador real headless con BD efímera; necesita Edge (Windows) o Chrome (Linux). El workflow ejecuta checks/integración/smokes y un job de compilación Kotlin Android; no despliega servicios.

Las pruebas SQLite usan archivos temporales aislados. SQLite sigue conteniendo solo diagnóstico; las claves, sesión y permisos firmados se guardan en SecureStore. No hay cola ni datos comerciales. Resultados históricos de base: [v0.1.0](docs/06-verificacion-base.md); acceso: [v0.2.0](docs/08-verificacion-acceso.md).

## Documentación

- [Acuerdos y primera entrega](docs/01-acuerdos-entregas.md).
- [Operación offline y sincronización](docs/02-operacion-sincronizacion.md).
- [Documentación funcional](docs/03-documentacion-funcional.md).
- [Método de desarrollo](docs/04-metodo-desarrollo.md).
- [Contrato de diagnóstico](docs/05-contratos-base.md).
- [Stack y evidencia](docs/decisiones/001-stack.md).
- [Spec 001](docs/specs/001-base-ejecutable.md).
- [Acceso y dispositivo](docs/07-acceso-dispositivo.md) y [spec 002](docs/specs/002-acceso-dispositivo.md).

Las reglas de offline de negocio siguen siendo: un único celular designado hasta 24 horas; demás equipos online; conflictos según primera operación válida aceptada por nube. El control de autorización de acceso está implementado; las operaciones y cola de negocio siguen pendientes.

## Siguiente funcionalidad

Planes/horarios y alumnos/inscripciones, después cobros/cajas y asistencia/sincronización de negocio, mediante specs antes del código sensible. La spec 002 implementa acceso/ámbito/permisos y autorización del dispositivo. Los detalles no resueltos se cierran en cada spec; no adelantar SUNAT, multimedia ni mensajería externa.
