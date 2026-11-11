# Levantar AquaGestión en tu PC con Windows

Esta guía es para la PC con Windows del responsable. Está escrita para alguien que no es experto: cada paso dice qué
escribir, qué debe aparecer y qué hacer si no aparece.

Al final tendrás la web abierta en `http://localhost:5173` con el mensaje **Sistema en línea**. PostgreSQL corre en
Docker, en tu PC, y solo es accesible desde tu PC.

## Antes de empezar

- Usa **PowerShell**: escribe `PowerShell` en el buscador de Windows y ábrelo. No necesitas ser administrador.
- Copia cada bloque de código, pégalo en PowerShell y pulsa Enter.
- Los comandos se ejecutan dentro de la carpeta del proyecto (`C:\proyectos\piscina`), salvo que se diga otra cosa.

## Requisitos (una sola vez)

| Programa         | Para qué sirve                              | Dónde conseguirlo                                           |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Git para Windows | Descargar el proyecto y traer sus cambios   | https://git-scm.com/download/win (opciones por defecto)     |
| Node.js 22       | Ejecutar la API y la web                    | Ver "Node.js 22, no la última" más abajo                    |
| Docker Desktop   | Ejecutar PostgreSQL                         | https://www.docker.com/products/docker-desktop/             |

### Node.js 22, no la última

El proyecto usa la rama 22 de Node.js, en la versión **22.22.3 o una más reciente de la 22**. La portada de
nodejs.org ofrece otra versión (por ejemplo, la 24 o la 26), y con esa `npm ci` se detiene.

1. Abre https://nodejs.org/dist/latest-v22.x/
2. Descarga el instalador de Windows de 64 bits de la versión 22 más alta: su nombre empieza por `node-v22.` y
   termina en `-x64.msi`.
3. Instálalo con las opciones por defecto.

Si ya tienes Node.js instalado con otra versión, desinstálalo primero desde *Configuración > Aplicaciones* y luego
instala la 22.

### Docker Desktop

Instálalo con las opciones por defecto. Si pide instalar WSL 2 o reiniciar la PC, acepta. Ábrelo y espera a que diga
que el motor está en ejecución (*Engine running*) antes de seguir. Si no arranca porque la virtualización está
desactivada, actívala en la BIOS (suele llamarse Intel VT-x o AMD-V).

Docker Desktop tiene que estar abierto cada vez que trabajes con la base de datos.

### Comprobar la instalación

Cierra PowerShell y ábrela otra vez (así lee las versiones nuevas) y ejecuta:

```powershell
git --version
node -v
docker --version
```

`node -v` debe mostrar una versión 22 igual o posterior a 22.22.3, por ejemplo `v22.22.3`. Si muestra otra cosa, revisa
"Node.js equivocado" en los problemas frecuentes.

## Primera vez

### Paso 1: descargar el proyecto

```powershell
New-Item -ItemType Directory -Force -Path C:\proyectos | Out-Null
cd C:\proyectos
git clone https://github.com/brayanAndy1996/piscina.git
cd piscina
```

`git clone` crea la carpeta `C:\proyectos\piscina` con todo el proyecto. La ruta es corta y sin espacios ni tildes, para
evitar problemas con las herramientas.

Si el proyecto ya está descargado, no lo vuelvas a clonar: entra a la carpeta y sigue con "Día a día".

### Paso 2: crear tu archivo de configuración

```powershell
Copy-Item .env.example .env
Test-Path .env
```

`Test-Path .env` debe responder `True`.

`.env` es tu configuración local. Los valores de `.env.example` ya funcionan con Docker, así que por ahora no cambies
nada. Git ignora `.env` a propósito: nunca lo subas a GitHub.

Si `.env` ya existe, no lo vuelvas a copiar: `Copy-Item` reemplaza el archivo y perderías tus cambios.

También puedes hacerlo con el Explorador de archivos: copia `.env.example`, pega la copia en la misma carpeta y cámbiale
el nombre a exactamente `.env`. Windows puede añadir "Copia de" al nombre; bórralo.

### Paso 3: instalar las dependencias

```powershell
npm ci
```

La primera vez tarda varios minutos y muestra muchas líneas: es normal. Ha terminado cuando vuelve a aparecer el
indicador `PS C:\proyectos\piscina>`. Si aparece un error, revisa "Problemas frecuentes".

### Paso 4: encender PostgreSQL

Comprueba que Docker Desktop está abierto y dice *Engine running*. Luego:

```powershell
docker compose up -d
docker compose ps
```

La primera vez Docker descarga la imagen de PostgreSQL 16, que puede tardar unos minutos. En la columna de estado de
`docker compose ps` debe aparecer `(healthy)`. Si aparece `starting`, espera unos segundos y repite
`docker compose ps`.

### Paso 5: crear las bases de datos

```powershell
npm run db:preparar
```

Crea las bases que falten: `aquagestion` (desarrollo) y `aquagestion_pruebas` (pruebas). Después aplica las migraciones
a ambas y ejecuta la semilla. Hoy la semilla solo escribe `Sin datos de ejemplo todavía.`, porque los datos de ejemplo
llegan con la historia 001. Es seguro repetir este comando: no borra nada.

### Paso 6: encender el sistema

```powershell
npm run dev
```

Se abren tres procesos, con los nombres `contratos`, `api` y `web`. Deja esta ventana abierta mientras trabajas. Para
detener todo, pulsa Ctrl+C en esa ventana. Si Windows pregunta `Terminar el trabajo por lotes (S/N)?`, responde `S`.

### Paso 7: ver el sistema

Abre el navegador y ve a **http://localhost:5173**. Debes ver el título **AquaGestión** y, debajo, el estado
**Sistema en línea**, con un punto verde.

Si la página no abre con `localhost`, prueba con **http://127.0.0.1:5173**.

La página muestra uno de cuatro estados:

| Lo que muestra la web               | Qué significa                                    | Qué hacer                                                                 |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Comprobando el sistema…             | Todavía consulta a la API.                       | Espera unos segundos y recarga la página.                                 |
| Sistema en línea                    | La API y la base de datos responden.             | Nada: todo está bien.                                                     |
| Sin conexión con la base de datos   | La API responde, pero PostgreSQL no.             | Abre Docker Desktop y ejecuta `docker compose up -d`.                     |
| No se pudo contactar al servidor    | La web no alcanza la API.                        | Revisa la ventana de `npm run dev`; si se cerró, ejecútalo otra vez.      |

## Día a día

Cada vez que vuelvas a trabajar, abre PowerShell y ejecuta, en este orden:

```powershell
cd C:\proyectos\piscina
git pull
npm ci
docker compose up -d
npm run db:migrar
npm run dev
```

- `git pull` trae los cambios que se hicieron en el repositorio.
- `npm ci` instala exactamente las dependencias de `package-lock.json`. Hazlo cuando `git pull` haya traído cambios; si
  no hubo cambios, también es seguro, solo tarda más.
- `docker compose up -d` enciende PostgreSQL. Si ya estaba encendido, no pasa nada.
- `npm run db:migrar` aplica las migraciones nuevas a la base de desarrollo. Si no hay ninguna pendiente, lo dice y no
  cambia nada.
- `npm run dev` enciende la API y la web.

Al terminar, pulsa Ctrl+C en la ventana de `npm run dev`. Puedes dejar PostgreSQL encendido o apagarlo con
`docker compose stop`; para encenderlo otra vez, usa `docker compose up -d`.

Para configurar el sistema, cambia `.env`. No edites los archivos del proyecto.

## Pruebas

| Comando            | Qué prueba                                             | Qué necesita                                        |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------- |
| `npm run test:unit`| Las pruebas que no usan la base de datos.              | Nada más.                                           |
| `npm test`         | Todas las pruebas, incluidas las de la base de datos.  | Docker encendido y `npm run db:preparar` hecho.     |
| `npm run e2e`      | El sistema dentro de un navegador real (Chromium).     | Instalar el navegador una vez (ver abajo).          |

Para `npm run e2e`, instala el navegador una sola vez:

```powershell
npx playwright install chromium
```

Después ejecuta:

```powershell
npm run e2e
```

Las pruebas E2E levantan la API y la web en otros puertos (3100 y 5180), así que puedes dejar `npm run dev` abierto.

## Comandos útiles

| Comando                                | Qué hace                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`                          | Enciende la API (puerto 3000) y la web (puerto 5173).                                     |
| `npm run db:preparar`                  | Crea las bases que falten, aplica las migraciones y la semilla. Seguro de repetir.        |
| `npm run db:migrar`                    | Aplica a la base de desarrollo las migraciones pendientes.                                |
| `npm run db:migrar:pruebas`            | Aplica las migraciones pendientes a la base de pruebas.                                   |
| `npm run db:semilla`                   | Carga los datos de ejemplo (hoy no carga ninguno).                                        |
| `npm run db:migracion`                 | Crea una migración nueva a partir de un cambio del esquema. Pide un nombre.               |
| `npm run lint`                         | Revisa el código con ESLint.                                                              |
| `npm run typecheck`                    | Revisa los tipos de TypeScript.                                                           |
| `npm run format:check`                 | Revisa el formato con Prettier. `npm run format` lo corrige.                              |
| `npm run build`                        | Compila contratos, API y web.                                                             |
| `npm run verificar:sin-secretos`       | Comprueba que el repositorio no versiona `.env` ni claves.                                |
| `npm run verificar:pruebas-protegidas` | Comprueba que las pruebas protegidas solo cambiaron en sus propios commits.               |

## Si Git rechaza un commit

Antes de guardar un commit, el proyecto revisa los archivos. Si lo rechaza, el mensaje dice qué archivo y qué regla
falló:

- **Formato:** Prettier lo corrige solo y el commit sigue. Vuelve a confirmar.
- **Lint:** corrige el error que indica el mensaje y vuelve a confirmar.
- **Pruebas protegidas:** no edites esos archivos ni quites la marca `spec: ...` de sus primeras líneas. Pide ayuda antes
  de seguir.

No uses `--no-verify` para saltarte la revisión.

## Problemas frecuentes

Puertos que usa el sistema: 5432 (PostgreSQL), 3000 (API), 5173 (web) y, solo para las pruebas E2E, 3100 y 5180.

### Docker Desktop está apagado

Síntomas: `docker compose up -d` dice `error during connect`; la web muestra **Sin conexión con la base de datos**; o
`npm run db:preparar` dice `No se pudo conectar a PostgreSQL`.

Solución: abre Docker Desktop, espera a que diga *Engine running* y ejecuta `docker compose up -d`. Luego comprueba con
`docker compose ps` que aparece `(healthy)` y recarga la web.

### El puerto 5432 está ocupado

Síntoma: `docker compose up -d` dice que el puerto 5432 ya está en uso. Suele pasar si hay un PostgreSQL instalado en
Windows. Para ver quién lo usa, ejecuta `Get-NetTCPConnection -LocalPort 5432`: si devuelve algo, el puerto está ocupado.

Solución: usa otro puerto, por ejemplo el 5433:

1. Abre `.env` con `notepad .env`.
2. Cambia `POSTGRES_PUERTO=5432` por `POSTGRES_PUERTO=5433`.
3. En `DATABASE_URL` y en `DATABASE_URL_PRUEBAS`, cambia `:5432/` por `:5433/`.
4. Guarda el archivo, ejecuta `docker compose up -d` y luego `npm run db:preparar`.

### El puerto 5173 o el 3000 está ocupado

Síntoma: `npm run dev` dice que un puerto ya está en uso. Suele ser otra ventana de `npm run dev` que quedó abierta:
ciérrala con Ctrl+C. Si no es eso, cambia `PUERTO_WEB` (y `PUERTO_API`) en `.env` y usa el nuevo puerto en el navegador.

### La web dice "No se pudo contactar al servidor"

La API no está encendida o se cayó. Revisa la ventana de `npm run dev`: el error aparece ahí. Ciérrala con Ctrl+C y
vuelve a ejecutar `npm run dev`.

### Node.js equivocado

Síntomas: `npm ci` se detiene con un error que menciona `EBADENGINE`, `Unsupported engine` o `>=22.12.0 <23`.

Solución:

1. Comprueba `node -v`. Si no muestra v22.22.3 o más, instala Node.js 22 (ver "Requisitos").
2. Cierra PowerShell y ábrela otra vez. Comprueba de nuevo `node -v`.
3. Borra las dependencias a medias (si existe la carpeta `node_modules`) y vuelve a instalarlas:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

### PowerShell no deja ejecutar npm

Síntoma: un error que menciona `npm.ps1` y dice que la ejecución de scripts está deshabilitada en este sistema.

Solución (una sola vez; no necesitas ser administrador):

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

Luego cierra PowerShell, ábrela otra vez y repite el comando que falló.

### El mensaje nombra una variable de `.env`

Ejemplos: `Falta la variable DATABASE_URL.` o un aviso de que el nombre de la base de pruebas debe terminar en `_pruebas`.

Solución: abre `.env` con `notepad .env`, compara sus líneas con `.env.example` y corrige la que falte o esté mal escrita.
Si no sabes qué valor poner, pide ayuda. No vuelvas a copiar `.env.example` encima: borrarías tus cambios.

### Playwright no encuentra el navegador

Síntoma: `npm run e2e` dice que no existe el ejecutable de Chromium. Solución: ejecuta `npx playwright install chromium` y
repite `npm run e2e`.

### Claude Code muestra un error de un hook al abrir una sesión

Si usas Claude Code en tu PC y aparece un error de un hook de inicio (`SessionStart`) que menciona
`preparar-sesion.mjs`, no tienes que hacer nada. Ese hook solo prepara las sesiones de la nube: en tu PC no cambia nada y
no afecta a `npm run dev` ni a las pruebas.

### Borrar la base de desarrollo y empezar de cero

Esto **borra todos los datos** de la base de desarrollo y de la de pruebas. No borra el código del proyecto. Hazlo solo
si quieres empezar desde cero:

```powershell
docker compose down -v
docker compose up -d
npm run db:preparar
```

`docker compose down` sin `-v` apaga y quita el contenedor, pero conserva los datos. Con `-v` también se borra el volumen
donde están guardados, por eso se pierde todo.
