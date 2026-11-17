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

Si `C:\proyectos\piscina` es una **unión de Windows** (un acceso creado con `mklink /J` que apunta a otra carpeta), los
comandos del proyecto funcionan igual, también los que se lanzan desde la unión. No hace falta cambiar nada.

### Paso 2: crear tu archivo de configuración

```powershell
Copy-Item .env.example .env
Test-Path .env
```

`Test-Path .env` debe responder `True`.

`.env` es tu configuración local. Los valores de `.env.example` ya funcionan con Docker, así que por ahora no cambies
nada. Git ignora `.env` a propósito: nunca lo subas a GitHub.

Si `.env` ya existe, no lo vuelvas a copiar: `Copy-Item` reemplaza el archivo y perderías tus cambios. Si tenías el
proyecto antes de la historia 001, ve a "Después de traer la historia 001" en lugar de copiarlo otra vez.

También puedes hacerlo con el Explorador de archivos: copia `.env.example`, pega la copia en la misma carpeta y cámbiale
el nombre a exactamente `.env`. Windows puede añadir "Copia de" al nombre; bórralo.

#### Cómo debe estar tu `.env`

- **Guárdalo en UTF-8**, con o sin BOM: se lee igual. Si lo editas con el Bloc de notas, guárdalo con codificación
  UTF-8. Si PowerShell lo guardó en UTF-16 (con `>` o con `Out-File` sin `-Encoding`), `env:completar` se niega y no
  escribe nada: ve a "`env:completar` dice que tu `.env` no está en UTF-8" en los problemas frecuentes.
- **Una variable por línea, con el formato `NOMBRE=valor`.** Escribe el nombre igual que en `.env.example`, en
  mayúsculas. En Windows, los nombres de las variables no distinguen mayúsculas (`PgPassword` y `PGPASSWORD` son la
  misma variable), así que una variable escrita de otra forma puede hacer que `env:completar` agregue de nuevo una que
  ya tenías.
- **No definas variables que empiecen con `DOTENV_`.**
- Los valores de `.env.example` son de ejemplo e inventados, para desarrollo. La contraseña de ejemplo del rol
  `aquagestion_app` nunca se usa en producción.

### Paso 3: instalar las dependencias

```powershell
npm ci
```

La primera vez tarda varios minutos y muestra muchas líneas: es normal. Ha terminado cuando vuelve a aparecer el
indicador `PS C:\proyectos\piscina>`. Si aparece un error, revisa "Problemas frecuentes".

Haz este paso antes de cualquier comando que lea tu `.env` (por ejemplo, `env:completar` o `db:preparar`): los scripts
leen el `.env` con el paquete `dotenv`, que se instala con `npm ci`.

### Paso 4: encender PostgreSQL

Comprueba que Docker Desktop está abierto y dice *Engine running*. Luego:

```powershell
docker compose up -d
docker compose ps
```

La primera vez Docker descarga la imagen de PostgreSQL 16, que puede tardar unos minutos. En la columna de estado de
`docker compose ps` debe aparecer `(healthy)`. Si aparece `starting`, espera unos segundos y repite
`docker compose ps`.

### Paso 5: crear el rol y las bases de datos

```powershell
npm run db:preparar
```

Hace cuatro cosas, en este orden:

1. Crea el rol `aquagestion_app`, con el que la API se conecta a la base (ver `DATABASE_URL_APP` en tu `.env`), si no
   existe.
2. Crea las bases que falten: `aquagestion` (desarrollo) y `aquagestion_pruebas` (pruebas).
3. Aplica las migraciones a las dos bases.
4. Ejecuta la semilla. Crea, si no existen, las academias de ejemplo `delfines` ("Academia de Natación Los Delfines") y
   `tiburones` ("Club de Natación Tiburones"), el superadmin de desarrollo, con los datos `SUPERADMIN_*` de tu `.env`, y
   los usuarios de ejemplo de cada academia (ver "Entrar como usuario de una academia").

Es seguro repetir este comando: no borra nada.

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

## Después de traer la historia 001

Si ya tenías el proyecto antes de la historia 001, no repitas "Primera vez". Haz estos pasos una vez, en la carpeta del
proyecto:

```powershell
git pull
npm ci
npm run env:completar
docker compose up -d
npm run db:preparar
npm run dev
```

- `npm ci` va antes de `env:completar`: el comando lee el `.env` con el paquete `dotenv`, que se instala con `npm ci`.
- `npm run env:completar` agrega a tu `.env` las variables nuevas que falten, desde `.env.example` (por ejemplo,
  `DATABASE_URL_APP`, `JWT_SECRETO` y `SUPERADMIN_CORREO`), sin tocar las que ya tienes. Dice cuáles agregó. Si no falta
  ninguna, lo dice y no cambia nada.
- `npm run db:preparar` crea el rol `aquagestion_app` que falte y aplica las migraciones nuevas a las dos bases.

Después, entra a la plataforma como se explica en la sección siguiente.

## Después de traer la historia 002

Si ya tenías el proyecto con la historia 001, haz estos pasos una vez, en la carpeta del proyecto:

```powershell
git pull
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

- `npm run db:preparar` aplica las migraciones nuevas (la tabla de usuarios) a las dos bases, la de desarrollo y la de
  pruebas, y ejecuta la semilla. La semilla agrega los usuarios de ejemplo de la sección "Entrar como usuario de una
  academia". Si ya existen, no los duplica ni les cambia la contraseña. Sin este paso, esos usuarios no existen y el
  ingreso responde «DNI o contraseña incorrectos».
- La historia 002 no agrega variables a `.env`, así que `npm run env:completar` no hace falta.

## Entrar a la plataforma y crear una academia de prueba

Con la historia 001, la plataforma de academias está en **http://localhost:5173/plataforma/ingresar**. La usa el
superadmin, que administra las academias y crea a los administradores de cada una (historia 002). Los demás usuarios de
cada academia entran por su propio enlace: ver "Entrar como usuario de una academia", más abajo.

1. Abre http://localhost:5173/plataforma/ingresar.
2. Escribe el correo y la clave del superadmin de desarrollo: son `SUPERADMIN_CORREO` y `SUPERADMIN_CLAVE` de tu `.env`.
   Debes llegar a la lista de academias (`/plataforma/academias`). Al principio aparecen `delfines` y `tiburones`, las
   academias de ejemplo.
3. Pulsa **Nueva academia** y escribe un nombre y un nombre corto. Por ejemplo: "Academia de prueba Norte" y
   `prueba-norte`. El nombre corto:
   - tiene de 3 a 30 caracteres: letras minúsculas sin tildes ni ñ, números y guiones;
   - no puede empezar ni terminar con guion, ni tener guiones seguidos;
   - empieza con una letra y no puede ser una palabra reservada;
   - se guarda en minúsculas aunque lo escribas con mayúsculas, y **no se puede cambiar** después de crear la academia,
     porque los enlaces que ya se hayan enviado dependen de él.
   Si el nombre corto ya está en uso, el formulario lo dice junto a ese campo.
4. Pulsa **Suspender** en la academia de prueba, escribe el motivo (es obligatorio) y confirma. Su estado pasa a
   suspendida. Sus datos se conservan.
5. Pulsa **Reactivar** y confirma. La academia vuelve a estar activa.
6. Pulsa **Cerrar sesión**. Vuelves a la pantalla de ingreso.

Cada alta, suspensión y reactivación queda registrada en la auditoría de la plataforma. Todavía no hay pantalla para
verla.

### Crear el administrador de una academia

Cada academia necesita al menos un administrador, y lo crea el superadmin (historia 002):

1. Entra como superadmin (los pasos de arriba) y, en la lista de academias, pulsa **Administradores** en la fila de la
   academia.
2. Pulsa **Crear administrador** y escribe el DNI (8 números), los nombres y los apellidos.
3. Si esa academia ya tiene una cuenta con ese DNI, el formulario lo dice junto al campo del DNI y no crea nada.
4. El administrador entra en `http://localhost:5173/a/{nombre corto}/ingresar` con su DNI. Su contraseña inicial es su
   DNI, y tiene que cambiarla al entrar.

En la misma lista, **Restablecer contraseña** devuelve la contraseña del administrador a su DNI, y lo desbloquea si
estaba bloqueado. La lista muestra también a los administradores inactivos.

Mientras la pregunta N11 de `specs/002-autenticacion-roles/spec.md` siga abierta, quien crea o restablece un
administrador conoce su contraseña inicial, que es su DNI. Por eso conviene que el administrador la cambie en su primer
ingreso.

### Crear o restablecer el superadmin

Solo quien administra el servidor puede crear o restablecer un superadmin: no hay registro desde la web. El comando lee
`SUPERADMIN_CORREO`, `SUPERADMIN_NOMBRE` y `SUPERADMIN_CLAVE`, además de `DATABASE_URL` de tu `.env`. Necesita Docker
encendido.

En PowerShell, dentro de la carpeta del proyecto:

```powershell
$env:SUPERADMIN_CORREO = "ana@ejemplo.test"
$env:SUPERADMIN_NOMBRE = "Ana Pérez"
$env:SUPERADMIN_CLAVE = "cambia-esta-clave-larga"
npm run plataforma:superadmin
```

- Si el correo no existe, el comando crea el superadmin y responde `Superadmin creado: ana@ejemplo.test`.
- Si el correo ya existe, cambia su nombre y su clave, y responde `Contraseña del superadmin restablecida:
  ana@ejemplo.test`. Las sesiones abiertas de ese superadmin dejan de valer.
- La clave tiene entre 12 y 128 caracteres. El comando nunca la muestra. Si algo falla, el mensaje dice qué variable
  revisar y no cambia nada.
- Las variables que escribes en PowerShell mandan sobre las de `.env`, así que la clave no tiene que quedar escrita en
  ningún archivo. Cierra la ventana cuando termines.
- Si olvidas la clave del superadmin, usa este mismo comando.
- Si te equivocas cinco veces seguidas al entrar, la cuenta queda bloqueada 15 minutos.

## Entrar como usuario de una academia

Cada academia tiene su enlace de ingreso, con su nombre corto en la dirección. Con los usuarios de ejemplo que crea
`npm run db:semilla`, puedes probarlo así:

1. Abre **http://localhost:5173/a/delfines/ingresar**. Debe aparecer el nombre de la academia, "Academia de Natación Los
   Delfines".
2. Escribe tu DNI (8 números) y tu contraseña, y pulsa **Ingresar**.
3. La primera vez, el sistema te lleva a **Cambiar contraseña**. Escribe la contraseña actual (tu DNI), la nueva y su
   confirmación, y pulsa **Guardar contraseña nueva**. La nueva debe tener de 8 a 128 caracteres y ser distinta de tu DNI
   y de la actual; no hacen falta números ni símbolos. Hasta que la cambies, el sistema no te deja ir a otra página, salvo
   para cerrar sesión.
4. Llegas a **/panel**, con tu nombre, tu rol y tu academia.
5. Para salir, pulsa **Cerrar sesión**. La cuenta se cierra en todos los dispositivos donde esté abierta.

Usuarios de ejemplo (los DNI y los nombres son inventados):

| Academia    | Usuario (DNI) | Rol           | Nombre              | Contraseña inicial |
| ----------- | ------------- | ------------- | ------------------- | ------------------ |
| `delfines`  | 10000001      | Administrador | Rosa Alvarez Prado  | 10000001           |
| `delfines`  | 10000002      | Secretaria    | Lucia Benites Rojas | 10000002           |
| `delfines`  | 10000003      | Entrenador    | Mario Castro Vega   | 10000003           |
| `delfines`  | 10000004      | Alumno        | Diego Delgado Soto  | 10000004           |
| `tiburones` | 10000001      | Administrador | Elena Espinoza Luna | 10000001           |

La contraseña inicial de cada uno es su DNI, y debe cambiarla al entrar. El DNI `10000001` aparece en `delfines` y en
`tiburones`: son dos cuentas distintas, una por academia (D-28).

Lo que ves en `/panel` depende del rol:

- **Administrador:** **Usuarios** (el personal) y **Restablecer contraseña**. En **Usuarios** puedes crear, desactivar,
  reactivar y restablecer al personal. No puedes desactivar ni restablecer tu propia cuenta.
- **Secretaria:** **Restablecer contraseña**, solo para alumnos.
- **Entrenador y alumno:** solo **Cambiar contraseña**. Las demás pantallas llegan con sus historias.

Quién restablece a quién: el administrador, a cualquier usuario de su academia menos a sí mismo; la secretaria, solo a
alumnos; el superadmin, a los administradores de cada academia. Restablecer deja la contraseña igual al DNI, y la persona
la cambia al entrar. Si olvidas tu contraseña, pide en recepción que la restablezcan.

Todavía no hay el panel del alumno con su carnet y su asistencia (historia 011), ni la pantalla de auditoría, ni la
configuración de los intentos y del bloqueo (historia 003).

## Día a día

Cada vez que vuelvas a trabajar, abre PowerShell y ejecuta, en este orden:

```powershell
cd C:\proyectos\piscina
git pull
npm ci
npm run env:completar
docker compose up -d
npm run db:migrar
npm run dev
```

- `git pull` trae los cambios que se hicieron en el repositorio.
- `npm ci` instala exactamente las dependencias de `package-lock.json`. Hazlo cuando `git pull` haya traído cambios; si
  no hubo cambios, también es seguro, solo tarda más.
- `npm run env:completar` agrega a tu `.env` las variables nuevas de `.env.example`, si las hay. Si no falta ninguna, no
  cambia nada.
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

| Comando                                | Qué hace                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run dev`                          | Enciende la API (puerto 3000) y la web (puerto 5173).                                                    |
| `npm run db:preparar`                  | Crea el rol y las bases que falten, aplica las migraciones y la semilla. Seguro de repetir.              |
| `npm run db:crear`                     | Crea solo el rol `aquagestion_app` y las bases que falten. Lo usa `db:preparar`.                         |
| `npm run db:migrar`                    | Aplica a la base de desarrollo las migraciones pendientes.                                               |
| `npm run db:migrar:pruebas`            | Aplica las migraciones pendientes a la base de pruebas.                                                  |
| `npm run db:semilla`                   | Crea las academias de ejemplo, el superadmin de desarrollo y los usuarios de ejemplo, si no existen. Repetirla no duplica nada ni cambia las contraseñas.   |
| `npm run db:migracion`                 | Crea una migración nueva a partir de un cambio del esquema. Pide un nombre.                              |
| `npm run env:completar`                | Agrega a `.env` las variables de `.env.example` que falten. No cambia las que ya tienes.                 |
| `npm run plataforma:superadmin`        | Crea el superadmin de la plataforma o le restablece la clave (usa `SUPERADMIN_*`; ver arriba).           |
| `npm run lint`                         | Revisa el código con ESLint.                                                                             |
| `npm run typecheck`                    | Revisa los tipos de TypeScript.                                                                          |
| `npm run format:check`                 | Revisa el formato con Prettier. `npm run format` lo corrige.                                             |
| `npm run build`                        | Compila contratos, API y web.                                                                            |
| `npm run verificar:sin-secretos`       | Comprueba que el repositorio no versiona `.env` ni claves.                                               |
| `npm run verificar:pruebas-protegidas` | Comprueba que las pruebas protegidas solo cambiaron en sus propios commits.                              |

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
3. En `DATABASE_URL`, en `DATABASE_URL_PRUEBAS` y en `DATABASE_URL_APP`, cambia `:5432/` por `:5433/`.
4. Guarda el archivo, ejecuta `docker compose up -d` y luego `npm run db:preparar`.

Si cambias el puerto de Docker, cámbialo también en `DATABASE_URL_APP`. Si no lo haces, `npm run db:crear` (y
`npm run db:preparar`, que lo usa) termina con error antes de tocar nada y dice que `DATABASE_URL_APP` debe apuntar al
mismo servidor, puerto y base que `DATABASE_URL`.

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

### `env:completar` dice que tu `.env` no está en UTF-8

Síntoma: `npm run env:completar` responde que tu `.env` no está guardado como UTF-8 y que parece UTF-16. No cambia nada.
Pasa cuando PowerShell 5.1 guarda el archivo con `>` o con `Out-File` sin `-Encoding`.

Solución, una de estas dos:

- En VS Code, abre `.env`, haz clic en la codificación que aparece abajo a la derecha, elige **Guardar con
  codificación** y luego **UTF-8**.
- En PowerShell, dentro de la carpeta del proyecto:

```powershell
Set-Content -Path .env -Encoding UTF8 -Value (Get-Content -Path .env)
```

Después vuelve a ejecutar `npm run env:completar`. Con o sin BOM, el archivo se lee igual.

### `env:completar` avisa de "una línea que parece definir" una variable

Síntoma: el comando termina con 0 y dice que la variable `NOMBRE` tiene en tu `.env` una línea que parece definirla pero
nadie la lee.

Esa línea no la lee nadie (ni la API ni los scripts): por ejemplo, `NOMBRE:valor` sin un espacio después de los dos
puntos, o una línea que quedó dentro de un valor entre comillas que no se cerró. El comando ya agregó la variable al
final desde `.env.example`. Revisa la línea, deja una sola definición como `NOMBRE=valor` y borra la otra.

### `env:completar` dice que agregar cambiaría cómo se lee tu `.env`

Síntoma: el comando dice que no modificó el `.env` porque agregar las variables que faltan cambiaría cómo se lee alguna
variable. No escribió nada.

Causa: la última línea tiene una comilla (`"`, `'` o `` ` ``) sin cerrar. Ciérrala o quítala y vuelve a ejecutar
`npm run env:completar`.

### Una variable aparece dos veces en el `.env`

Vale la **última** definición, tanto para la API como para los scripts. Deja una sola.

### "Falta el paquete dotenv"

Síntoma: un comando que lee el `.env` dice `Falta el paquete dotenv, con el que se lee el .env`.

Solución: ejecuta `npm ci` y vuelve a intentarlo. Hazlo antes de los comandos `db:*` y de `env:completar`.

### El mensaje nombra una variable de `.env`

Ejemplos: `Falta la variable DATABASE_URL.`, `Falta la variable DATABASE_URL_APP.` o un aviso de que el nombre de la base
de pruebas debe terminar en `_pruebas`.

Solución: ejecuta `npm run env:completar`, que agrega las variables que falten desde `.env.example`. Si la variable ya
está y el mensaje sigue, abre `.env` con `notepad .env`, compara sus líneas con `.env.example` y corrige la que esté mal
escrita. Si no sabes qué valor poner, pide ayuda. No vuelvas a copiar `.env.example` encima: borrarías tus cambios.

### "Falta el rol aquagestion_app"

Síntoma: `npm run db:preparar` o `npm run db:migrar` dicen `Falta el rol aquagestion_app: ejecuta npm run db:crear (o
npm run db:preparar).`

Solución: asegúrate de que Docker Desktop está encendido y de que `docker compose ps` muestra `(healthy)`, y ejecuta
`npm run db:preparar`. Si `db:crear` dice que el usuario de `DATABASE_URL` no puede crear roles, revisa que `DATABASE_URL`
sea el usuario de Docker (`aquagestion`) y pide ayuda si sigue igual.

### "El rol aquagestion_app no es seguro"

Síntoma: `npm run db:crear` dice que el rol ya existe pero no es seguro y enumera lo que le sobra (por ejemplo,
`SUPERUSER` o `BYPASSRLS`). Si intentas entrar a la plataforma, la página muestra un error del servidor, y la ventana de
`npm run dev` dice que el rol de `DATABASE_URL_APP` no es seguro. Mientras siga así, la API no atiende datos: es lo
esperado.

Solución: en tu PC, lo más simple es empezar de cero con la sección "Borrar la base de desarrollo y empezar de cero". El
rol se vuelve a crear con los atributos correctos, pero se borran los datos de desarrollo. Si quieres conservarlos, pide
ayuda antes de cambiar el rol a mano: el mensaje de `db:crear` dice qué quitar.

Ten en cuenta que `db:crear` no cambia la contraseña de un rol que ya existe. Si cambiaste la de `DATABASE_URL_APP`
después de crear el rol, la API no podrá entrar a la base; la forma más simple de corregirlo en tu PC también es empezar
de cero.

### Playwright no encuentra el navegador

Síntoma: `npm run e2e` dice que no existe el ejecutable de Chromium. Solución: ejecuta `npx playwright install chromium` y
repite `npm run e2e`.

### No puedo entrar a la academia

Según el mensaje que muestre la página de ingreso:

- **«DNI o contraseña incorrectos.»** Revisa el DNI (8 números) y la contraseña. Si nunca la cambiaste, es tu DNI. Si ni
  los usuarios de ejemplo entran, ejecuta `npm run db:semilla` (es seguro repetirlo): puede faltar la semilla de la 002.
- **«Hiciste demasiados intentos. Espera un minuto.»** Hay un límite de 10 ingresos por minuto desde una misma red, y todas
  las personas de esa red cuentan juntas. Espera un minuto.
- **«La cuenta está bloqueada por varios intentos fallidos…»** Cinco intentos fallidos seguidos bloquean la cuenta 15
  minutos. Espera, o pide en recepción que restablezcan la contraseña: eso la desbloquea. Si el bloqueado es el único
  administrador, lo restablece el superadmin, en **Administradores** de la academia.
- **«Tu cuenta está desactivada. Consulta en recepción.»** Un administrador de la academia la reactiva.
- **«Academia no disponible por el momento.»** El superadmin suspendió la academia. Sus datos se conservan; se reactiva
  desde la lista de academias.
- **«No encontramos esa academia. Revisa el enlace.»** Revisa el nombre corto de la dirección, por ejemplo
  `/a/delfines/ingresar`.

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
donde están guardados, por eso se pierde todo. `npm run db:preparar` vuelve a crear el rol `aquagestion_app` y la semilla.
