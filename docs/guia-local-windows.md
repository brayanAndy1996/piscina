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

PostgreSQL tiene que usar un locale UTF-8 en sus bases. `docker-compose.yml` no lo fija: usa la imagen `postgres:16` sin
cambios, así que si una prueba de nombres con acentos falla, revisa "La base no está en UTF-8" en los problemas
frecuentes. No crees ni cambies una base a mano con locale `C` o `POSIX`: `npm run db:crear` no fija el locale y las bases
toman el del servidor.

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
   `tiburones` ("Club de Natación Tiburones"), el superadmin de desarrollo, con los datos `SUPERADMIN_*` de tu `.env`, los
   usuarios de ejemplo de cada academia (ver "Entrar como usuario de una academia") y el teléfono de ejemplo de `delfines`
   (ver "Probar la configuración de la academia"), y los planes y clases de ejemplo (ver "Probar planes y clases").

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

## Después de traer la historia 003

Si ya tenías el proyecto con la historia 002, haz estos pasos una vez, en la carpeta del proyecto:

```powershell
git pull
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

- La historia 003 no tiene migraciones ni variables nuevas en `.env`, así que `npm run env:completar` no hace falta.
- `npm run db:preparar` ejecuta la semilla, que agrega a `delfines` un teléfono de ejemplo (`+51 999 000 111`). Si la fila
  del teléfono ya existe, no la toca, aunque la hayas cambiado o quitado. Sin este paso, `delfines` no tiene teléfono.

## Después de traer la historia 004

Si ya tenías el proyecto con la historia 003, haz estos pasos una vez, en la carpeta del proyecto:

```powershell
git pull
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

- `npm ci` instala las dos librerías de fechas que agrega la 004 (`date-fns` y `@date-fns/tz`).
- `npm run db:preparar` crea las tablas de planes y clases, aplicando sus migraciones a las dos bases, la de desarrollo y la
  de pruebas, y ejecuta la semilla. Sin este paso no existen las tablas y las pantallas **Planes** y **Clases y horarios**
  dan error.
- La semilla agrega a `delfines` un segundo entrenador (Paula Fuentes Ibarra, DNI `10000005`, con la contraseña inicial
  igual a su DNI), dos planes y cinco clases de ejemplo. Repetirla no duplica nada (ver "Probar planes y clases").
- La historia 004 no agrega variables a `.env`, así que `npm run env:completar` no hace falta.

## Después de traer la historia 005a

Si ya tenías el proyecto con la historia 004, haz estos pasos una vez, en la carpeta del proyecto:

```powershell
git pull
npm ci
docker compose up -d
npm run db:preparar
npm run dev
```

- `npm run db:preparar` aplica a las dos bases las migraciones de la 005a (las tablas de la inscripción y la regla del fin de
  mes) y ejecuta la semilla. La semilla agrega a `delfines` tres clases de Básico (martes, miércoles y jueves a las 18:00,
  con Paula Fuentes) y tres clientes con una solicitud de ejemplo (ver "Probar la inscripción pública"). Repetirla no
  duplica nada.
- Si `npm run db:preparar` se detiene en «Migrando la base de desarrollo» con el código 23514, tu base es de una versión
  anterior de esta rama. Mira "La migración `20261120190000_reserva_dentro_del_mes` falla con 23514", en "Problemas
  frecuentes": la solución es empezar de cero.
- La historia 005a no agrega variables a `.env`, así que `npm run env:completar` no hace falta.

## Después de traer la historia 005b

Si ya tenías el proyecto con la historia 005a, haz estos pasos una vez, en la carpeta del proyecto:

```powershell
git pull
npm ci
docker compose up -d
npm run dev
```

- `npm ci` instala `sharp`, la librería que recodifica las fotos. Sus binarios de Windows los instala como dependencias
  opcionales, así que no hay que compilar nada. Si la API no arranca con un error de sharp, mira "`npm ci` falla con sharp, o la
  API no arranca con «Could not load the "sharp" module»" en "Problemas frecuentes".
- La 005b no tiene migraciones ni cambia la semilla, así que `npm run db:preparar` no hace falta. Si ejecutas
  `npm run db:migrar`, dirá que no hay nada que aplicar.
- La 005b agrega `ALMACEN_DIRECTORIO` a `.env.example`, pero comentada. Por eso `npm run env:completar` no la agrega a tu `.env`,
  y no hace falta: si no está, las fotos se guardan en `backend\almacenamiento`, dentro de la carpeta del proyecto, que Git no
  sube. Si quieres otra carpeta, mira "Dónde se guardan las fotos".

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

| Academia    | Usuario (DNI) | Rol           | Nombre               | Contraseña inicial |
| ----------- | ------------- | ------------- | -------------------- | ------------------ |
| `delfines`  | 10000001      | Administrador | Rosa Alvarez Prado   | 10000001           |
| `delfines`  | 10000002      | Secretaria    | Lucia Benites Rojas  | 10000002           |
| `delfines`  | 10000003      | Entrenador    | Mario Castro Vega    | 10000003           |
| `delfines`  | 10000004      | Alumno        | Diego Delgado Soto   | 10000004           |
| `delfines`  | 10000005      | Entrenador    | Paula Fuentes Ibarra | 10000005           |
| `tiburones` | 10000001      | Administrador | Elena Espinoza Luna  | 10000001           |

La contraseña inicial de cada uno es su DNI, y debe cambiarla al entrar. El DNI `10000001` aparece en `delfines` y en
`tiburones`: son dos cuentas distintas, una por academia (D-28).

`delfines` también tiene un teléfono de ejemplo, `+51 999 000 111`, que se ve en **Configuración** (ver "Probar la
configuración de la academia"). Además tiene un segundo entrenador (Paula Fuentes Ibarra), dos planes y ocho clases de
ejemplo (ver "Probar planes y clases"), y tres clientes con una solicitud de inscripción (ver "Probar la inscripción pública").

Lo que ves en `/panel` depende del rol:

- **Administrador:** **Usuarios** (el personal), **Restablecer contraseña**, **Configuración** (la configuración de la
  academia, más abajo) y **Planes** y **Clases y horarios** (ver "Probar planes y clases"). En **Usuarios** puedes crear, desactivar,
  reactivar y restablecer al personal. No puedes desactivar ni restablecer tu propia cuenta.
- **Secretaria:** **Restablecer contraseña**, solo para alumnos.
- **Entrenador y alumno:** solo **Cambiar contraseña**. Las demás pantallas llegan con sus historias.

Quién restablece a quién: el administrador, a cualquier usuario de su academia menos a sí mismo; la secretaria, solo a
alumnos; el superadmin, a los administradores de cada academia. Restablecer deja la contraseña igual al DNI, y la persona
la cambia al entrar. Si olvidas tu contraseña, pide en recepción que la restablezcan.

Todavía no hay el panel del alumno con su carnet y su asistencia (historia 011) ni la pantalla de auditoría.

## Probar la configuración de la academia

La pantalla **Configuración** (historia 003) la ve solo el administrador de la academia, desde el inicio del panel. Para
probarla con los datos de ejemplo:

1. Entra como administrador de `delfines` en http://localhost:5173/a/delfines/ingresar, con el DNI `10000001`. Si nunca
   cambiaste la contraseña, la inicial es `10000001` y el sistema te pide cambiarla.
2. En el inicio del panel (`/panel`), pulsa **Configuración**. Verás el nombre de la academia, que no se cambia desde ahí,
   y el **Teléfono de la academia**, que en `delfines` es `+51 999 000 111`. La cabecera del panel muestra el mismo
   teléfono.
3. Cambia **Intentos fallidos antes del bloqueo (intentos)** de 5 a 3 y pulsa **Guardar cambios**. Debe aparecer
   **Configuración guardada.** Cada campo tiene el botón **Usar el valor por defecto**, que vuelve a su valor inicial.
4. Pulsa **Cerrar sesión**.
5. Entra en http://localhost:5173/a/delfines/ingresar con el DNI `10000004` (el alumno de ejemplo) y una contraseña
   equivocada, por ejemplo `equivocada`. Los dos primeros intentos muestran **DNI o contraseña incorrectos.** El tercero
   muestra: «La cuenta está bloqueada por varios intentos fallidos. Intenta de nuevo en 15 minutos. Si no puedes esperar,
   pide en recepción que restablezcan tu contraseña.»
6. Prueba con la contraseña correcta (`10000004`): la cuenta sigue bloqueada hasta que pasen los 15 minutos.
7. Para desbloquearla antes, entra como administrador, pulsa **Restablecer contraseña** en el inicio del panel, busca el
   DNI `10000004`, pulsa **Restablecer contraseña** y confírmalo. La contraseña vuelve a ser el DNI y la cuenta queda
   desbloqueada.
8. Vuelve a **Configuración**, pulsa **Usar el valor por defecto** en "Intentos fallidos antes del bloqueo" (vuelve a 5)
   y después **Guardar cambios**.

Estos son los campos de la pantalla, con su valor por defecto y su rango. Hoy solo tienen efecto el bloqueo y el teléfono;
los demás se guardan y los usarán sus historias.

| Campo                                                | Por defecto  | Rango             | Qué hace hoy                                                                      |
| ---------------------------------------------------- | ------------ | ----------------- | --------------------------------------------------------------------------------- |
| Tolerancia de tardanza (minutos)                     | 10           | de 0 a 30         | Se guarda; la asistencia la usará (historia 009).                                  |
| Días para marcar una mensualidad "por vencer" (días) | 5            | de 1 a 15         | Se guarda; las mensualidades la usarán (historia 010).                             |
| Días de prioridad para renovar (días)                | 5            | de 1 a 15         | Se guarda; la renovación la usará (historia 010).                                  |
| Intentos fallidos antes del bloqueo (intentos)       | 5            | de 3 a 10         | Ya se aplica al ingreso y al cambio de contraseña.                                 |
| Duración del bloqueo (minutos)                       | 15           | de 5 a 60         | Ya se aplica al ingreso y al cambio de contraseña.                                 |
| Teléfono de la academia                              | Sin teléfono | 6 a 20 caracteres | Ya se ve en la cabecera del panel y en las páginas públicas (ingreso, inscripción y seguimiento). |

Otras comprobaciones:

- Con una cuenta de secretaria, entrenador o alumno, **Configuración** no aparece en el inicio del panel. Si entran a
  `/panel/configuracion`, la página dice «No tienes permiso para ver esta página».
- Si borras el teléfono y guardas, la academia deja de tener teléfono: desaparece de la cabecera del panel.

## Probar planes y clases

Los **planes** y las **clases** (historia 004) los configura solo el administrador, desde el inicio del panel. Para
probarlos con los datos de ejemplo de `delfines`:

1. Entra como administrador de `delfines` en http://localhost:5173/a/delfines/ingresar, con el DNI `10000001`. Si nunca
   cambiaste la contraseña, la inicial es `10000001` y el sistema te pide cambiarla.
2. En el inicio del panel (`/panel`), pulsa **Planes**. Verás dos planes de ejemplo, los dos **Vigente**: **3 veces por
   semana** (12 clases al mes, S/ 120.00, lunes, miércoles y viernes) y **2 veces por semana** (8 clases al mes, S/ 90.00,
   martes y jueves). Cada precio dice «IGV incluido».
3. Pulsa **Nuevo plan** y crea un plan de prueba: en **Nombre del plan**, `Plan de prueba`; en **Veces por semana**, `2`;
   en **Clases por mes**, `8`; **Duración (minutos)** ya trae `60`; en **Precio (S/)**, `90.00`; en **Días permitidos**,
   martes y jueves; en **Franjas permitidas**, `08:00 a 09:00`, y en **Niveles**, Básico. Pulsa **Crear plan**: debe
   aparecer **Plan «Plan de prueba» creado.** El precio se escribe con punto: con una coma (`90,00`) aparece un error junto
   a **Precio (S/)**.
4. Provoca un nombre repetido: pulsa **Nuevo plan**, escribe `plan de PRUEBA` y completa lo demás igual. Pulsa **Crear
   plan**: junto a **Nombre del plan** aparece «Ya hay un plan con ese nombre en tu academia (se comparan sin distinguir
   mayúsculas).». Pulsa **Cancelar**.
5. Pulsa **Editar** en **Plan de prueba**, quita la marca de **Plan activo** y pulsa **Guardar cambios**. El plan aparece
   como **Inactivo**: no se borra, y puedes volver a activarlo.
6. Pulsa **← Volver al inicio** y después **Clases y horarios**. Verás la semana: siete días por bloques de 1 hora, de
   08:00 a 20:00, y cada clase en su bloque, con su entrenador y su aforo. En `delfines` hay ocho clases de ejemplo. Dos están el
   **lunes a las 18:00**: una Básico con Mario Castro y una Intermedio con Paula Fuentes (dos entrenadores distintos en el
   mismo bloque). Las otras tres son de Básico, **martes, miércoles y jueves a las 18:00**, con Paula Fuentes; las añadió la
   historia 005a.
7. Pulsa **Nueva clase** y crea una clase que choca: **Nivel** Avanzado, **Día** Lunes, **Bloque** 18:00 a 19:00,
   **Entrenador** «Castro Vega, Mario» y **Aforo (alumnos)** `25`. Pulsa **Crear clase**: bajo **Entrenador** aparece «Ese
   entrenador ya tiene otra clase activa a esa hora.», porque Mario ya tiene la Básico del lunes a las 18:00. Ahora cambia
   **Nivel** a Básico y **Entrenador** a «Fuentes Ibarra, Paula», y pulsa **Crear clase** otra vez: bajo **Nivel** aparece
   «Ya hay una clase activa de ese nivel el mismo día y a la misma hora.».
8. Crea una clase que sí cabe: **Nivel** Avanzado, **Día** Viernes, **Bloque** 18:00 a 19:00, **Entrenador** «Fuentes
   Ibarra, Paula» y **Aforo (alumnos)** `20`. Pulsa **Crear clase**: aparece «Clase creada: Avanzado, viernes de 18:00 a
   19:00.».
9. Prueba el aforo: pulsa la clase Avanzado del viernes en la grilla y después **Editar clase**. Escribe `19` en **Aforo
   (alumnos)** y pulsa **Guardar cambios**: aparece «El aforo debe ser de 20 a 50 alumnos.». Escribe `50`, guarda, y
   aparece «Clase guardada.». El aforo acepta exactamente de 20 a 50.
10. Desactiva una clase: en **Editar clase**, quita la marca de **Clase activa** y pulsa **Guardar cambios**. En la grilla,
    la clase aparece con la insignia **Inactiva**, y su bloque queda libre para otra clase del mismo nivel.
11. Ver la grilla en el celular: en Chrome o Edge, pulsa **F12**, luego el icono del celular (o **Ctrl+Mayús+M**) y elige
    un modelo. También sirve reducir la ventana a menos de 768 píxeles de ancho. Verás los días como botones (**Lun**,
    **Mar**, **Mié**, **Jue**, **Vie**, **Sáb** y **Dom**) y la grilla muestra un solo día; los bloques sin clases dicen
    «Sin clases». Al abrir la página aparece el día de hoy según la hora de Lima. Pulsa **Vie** para ver las clases del
    viernes.

Otras comprobaciones:

- Con una cuenta de secretaria, entrenador o alumno, **Planes** y **Clases y horarios** no aparecen en el inicio del
  panel. Si entran a `/panel/planes` o `/panel/clases`, la página dice «No tienes permiso para ver esta página».
- Los planes y las clases no tienen botón para borrarlos: se desactivan.
- Crea o edita un plan con **Vigente desde** en una fecha futura: aparece como **Programado**. Con **Vigente hasta** en una
  fecha pasada, aparece como **Vencido**.
- Repetir `npm run db:semilla` no duplica nada ni cambia lo que hayas editado. Los planes de ejemplo se reconocen por su
  nombre: si cambias el nombre de **3 veces por semana** o de **2 veces por semana**, la siguiente ejecución lo vuelve a
  crear. Las clases de ejemplo se reconocen por su nivel, día y bloque: si las desactivas o cambias su entrenador, no se
  vuelven a crear.

## Probar la inscripción pública

La inscripción (historia 005a) no pide sesión: cualquier persona la llena desde su celular o desde la PC de recepción. Con
`npm run dev` encendido, prueba el flujo completo con `delfines`:

1. Abre **http://localhost:5173/a/delfines/inscripcion**. Verás el nombre de la academia, su teléfono y el formulario
   **Inscripción**, en pasos: **Datos personales**, **Ficha médica**, **Apoderado** (solo si la persona es menor de 18 años),
   **Plan y horario** y **Resumen y confirmación**.
2. En **Datos personales**, escribe un DNI que no esté en `delfines`, por ejemplo `30000001`, y los nombres, los apellidos,
   la fecha de nacimiento y el celular. En **Ficha médica**, elige el tipo de sangre y escribe el nombre y el celular del
   contacto de emergencia; lo demás es opcional. Pulsa **Siguiente** en cada paso.
3. En **Plan y horario**, elige el **Nivel** (Básico, Intermedio o Avanzado). Solo verás los planes vigentes de ese nivel, y
   solo las clases con cupo. Elige un plan y una clase por cada día, tantas como indique el plan (en el de 3 veces por
   semana, tres). Pulsa **Siguiente**: la página calcula el monto.
4. En **Resumen y confirmación** revisa el monto, que dice «El precio ya incluye IGV.». Marca **Acepto el tratamiento de
   datos personales** y **Acepto el deslinde de responsabilidad**, y pulsa **Enviar inscripción**.
5. La página **Tu solicitud quedó registrada** muestra tu código (`AQ-` y seis caracteres), el enlace de seguimiento y hasta
   qué hora está reservado tu cupo (hora de Lima). Copia el código y el enlace: son la única forma de seguir tu solicitud.
   En desarrollo, el correo es simulado: no sale ningún mensaje, y el enlace solo se ve en esta pantalla.
6. Pulsa **Ver el seguimiento de mi solicitud**. Verás el estado **Pendiente de pago**, el plan, los días y las horas, el
   monto y la fecha límite de la reserva.
7. Para consultar con el código, abre **http://localhost:5173/a/delfines/solicitud**, escribe el código y tu DNI, y pulsa
   **Consultar**.

Solicitudes de ejemplo (los DNI y los nombres son inventados). Se consultan con el código y el DNI, porque sus enlaces de
seguimiento no se guardan en claro:

| Código      | DNI      | Qué verás                                                                 |
| ----------- | -------- | ------------------------------------------------------------------------- |
| `AQ-SM0001` | 20000001 | **Pendiente de pago**, con la fecha límite de su reserva.                 |
| `AQ-SM0002` | 20000002 | **Vencida**: sin nombre ni fecha límite.                                  |
| `AQ-SM0003` | 20000003 | **Pendiente de pago**. Es la solicitud de un menor de edad con apoderado. |

Las reservas de ejemplo vigentes vencen el último día del mes en Lima. Después de ese día, aparecen como **Vencida**.

Otras comprobaciones:

- Con el DNI `20000001`, que ya tiene una solicitud en `delfines`, el formulario responde «Este DNI ya tiene una inscripción
  o solicitud en esta academia», y ofrece consultar con el código y el DNI.
- Si una clase se llena antes de que envíes, la página la quita de tu selección y dice «Se llenó: …». Elige otra opción.
- Con un código y un DNI que no corresponden, la consulta responde «No encontramos una solicitud con ese código y ese DNI.
  Revísalos e inténtalo de nuevo.». Es el mismo mensaje que si el código no existe.
- **Límites.** Hay límites por conexión: 60 lecturas por minuto, 30 cotizaciones por minuto, 10 envíos por hora y 10
  consultas por minuto. Cada intento cuenta, también los que fallan. En tu PC, la web pasa por Vite y la API ve todas las
  peticiones desde la misma dirección (127.0.0.1): **todas tus pruebas comparten esa conexión**. Si el formulario responde
  «Hiciste demasiados envíos desde esta conexión.», espera un rato o vuelve a ejecutar `npm run dev`: los contadores de
  minutos y de horas viven en memoria y se ponen a cero al reiniciar.
- **Reservas sin pagar.** Una conexión puede tener como mucho cinco solicitudes sin pagar. A la sexta, el formulario responde
  «Ya tienes varias reservas sin pagar desde esta conexión.». Estas reservas están en la base, así que reiniciar
  `npm run dev` no las quita: vencen solas, a las 24 horas o al fin del mes en Lima, lo que ocurra primero. Para empezar de
  cero, mira «Borrar la base de desarrollo y empezar de cero».

## Probar la foto y el panel de solicitudes

La foto de la inscripción (historia 005b) es opcional, y la sube la propia persona en el mismo formulario. Con `npm run dev`
encendido:

1. Abre **http://localhost:5173/a/delfines/inscripcion** y completa el formulario como en "Probar la inscripción pública".
   En el paso **Foto (opcional)**, pulsa **Elegir una foto** y elige un JPG o un PNG de tu PC. Verás una vista previa. Si el
   archivo pesa más de 5 MB o no es JPG ni PNG, la página lo avisa antes de subirlo. También puedes seguir sin foto.
2. Pulsa **Enviar inscripción**. Al terminar, la página muestra tu código y el enlace de seguimiento, y la foto se sube sola.
   Si la subida falla, la solicitud ya está creada: la página lo dice, y puedes subir la foto desde el enlace de seguimiento.
3. Abre el enlace de seguimiento. Mientras la solicitud esté pendiente de pago, verás **Foto cargada** y la opción de cambiarla
   (**Elegir otra foto**). Si la solicitud ya venció o se canceló, esa opción no aparece.

La foto no se puede ver desde la web todavía: eso llega con el carnet (historia 008). Para comprobar que se guardó, mira la
carpeta de "Dónde se guardan las fotos" más abajo.

Hay un límite de 10 subidas de foto por hora desde cada conexión. En tu PC, todas las pruebas comparten esa conexión (ver los
límites en "Probar la inscripción pública"), así que si te pasas, espera un rato o vuelve a ejecutar `npm run dev`.

Panel de solicitudes. Entra en **http://localhost:5173/a/delfines/ingresar** con el DNI de la administradora (`10000001`) o de
la secretaria (`10000002`), de la tabla de "Entrar como usuario de una academia". Si te pide cambiar la contraseña, cámbiala.

4. En el inicio del panel, pulsa **Solicitudes de inscripción** (`/panel/solicitudes`). Verás las solicitudes **Activas**, con su
   código, nombre, DNI, teléfono, plan, días y horas, monto y fecha límite de la reserva. Cambia el filtro a **Vencidas**,
   **Canceladas** o **Todas** para ver las demás.
5. Pulsa **Cancelar** en una solicitud. El botón solo aparece en las activas y en las vencidas. Escribe el motivo (de 3 a 200
   caracteres) y confirma. La solicitud pasa a **Cancelada** y libera el cupo de sus clases. La persona no recibe ningún correo,
   y en su enlace de seguimiento verá "Cancelada". Su foto no se borra.
6. En el inicio del panel, **Nueva inscripción** abre en otra pestaña el formulario público de la academia, para inscribir a
   alguien en recepción.
7. En **Clases y horarios**, cada clase muestra "inscritos / aforo". Esa grilla solo la ve el administrador.

Las pruebas automáticas de esta historia corren con `npm test` (necesita PostgreSQL) y con `npm run test:unit`. Ninguna escribe en
tu carpeta `backend\almacenamiento`: usan una carpeta temporal, que se borra al terminar.

## Dónde se guardan las fotos (ALMACEN_DIRECTORIO)

La variable `ALMACEN_DIRECTORIO` de tu `.env` indica en qué carpeta se guardan las fotos.

- **Por defecto**, si no está en tu `.env`, la carpeta es `backend\almacenamiento` dentro de tu proyecto (por ejemplo,
  `C:\proyectos\piscina\backend\almacenamiento`). Git la ignora, así que no se sube a GitHub.
- Una ruta **relativa** se cuenta desde la carpeta del proyecto. Una ruta **absoluta** también vale, con `\` o con `/`, por
  ejemplo `ALMACEN_DIRECTORIO=C:/datos/aquagestion`.
- Para cambiarla, abre `.env` con `notepad .env` y agrega una línea `ALMACEN_DIRECTORIO=...`. No copies `.env.example` encima.
  `npm run env:completar` no la agrega sola, porque en `.env.example` está comentada.

La API **no arranca** si la ruta tiene alguna de estas formas. El mensaje de error nombra la variable, pero no muestra la ruta:

- un carácter de control, como un tabulador dentro de la ruta;
- un prefijo de Windows como `\\?\C:\…` o `\\.\C:\…`, o una ruta de red como `\\servidor\recurso`;
- los caracteres `< > " | ? *`, o un `:` que no esté al principio, como en `carpeta\x:datos` o `D:carpeta`;
- un nombre que termina en punto o en espacio, como `frontend.\public`, que Windows lee como `frontend\public`;
- una carpeta dentro de `frontend\`, `packages\` o `node_modules\` del proyecto (también `frontend\public`), da igual si está en
  mayúsculas o en minúsculas. Un nombre corto de Windows, como `NODE_M~1`, que apunte allí también se rechaza.

Un nombre corto justo debajo del proyecto, como `ALMAC~1`, también se rechaza: escribe el nombre largo. Después de cambiar el
valor, guarda `.env` como UTF-8 y vuelve a ejecutar `npm run dev`.

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
| `npm run db:semilla`                   | Crea las academias de ejemplo, el superadmin de desarrollo, los usuarios de ejemplo y el teléfono de ejemplo de `delfines`, sus planes y clases de ejemplo y sus clientes con solicitud, si no existen. Repetirla no duplica nada ni cambia las contraseñas, el teléfono ni lo que hayas editado.   |
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

### La base no está en UTF-8 (falla la prueba de nombres con acentos)

Síntoma: `npm test` falla en `planes-nombre-letras-acentuadas.test.ts`, porque «Plan Natación» y «PLAN NATACIÓN» se aceptan
como dos nombres distintos. Esa prueba exige que PostgreSQL ponga en minúsculas las letras acentuadas, y con los locales `C` o
`POSIX` no lo hace.

Para ver el locale de las bases, con Docker encendido y dentro de la carpeta del proyecto:

```powershell
docker compose exec postgres psql -U aquagestion -d aquagestion -c "SELECT datname, datctype FROM pg_database WHERE datname LIKE 'aquagestion%';"
```

Las dos bases, `aquagestion` y `aquagestion_pruebas`, deben salir con un valor UTF-8, como `en_US.utf8` o `C.UTF-8`. Si
`aquagestion_pruebas` no aparece, ejecuta `npm run db:preparar`. Si alguna sale con `C` o `POSIX`, la forma más simple de
corregirlo es empezar de cero, como se explica en "Borrar la base de desarrollo y empezar de cero" (se pierden los datos de
desarrollo). No cambies el locale de una base a mano. Si después de eso sigue igual, pide ayuda.

### Playwright no encuentra el navegador

Síntoma: `npm run e2e` dice que no existe el ejecutable de Chromium. Solución: ejecuta `npx playwright install chromium` y
repite `npm run e2e`.

### No puedo entrar a la academia

Según el mensaje que muestre la página de ingreso:

- **«DNI o contraseña incorrectos.»** Revisa el DNI (8 números) y la contraseña. Si nunca la cambiaste, es tu DNI. Si ni
  los usuarios de ejemplo entran, ejecuta `npm run db:semilla` (es seguro repetirlo): puede faltar la semilla de la 002.
- **«Hiciste demasiados intentos. Espera un minuto.»** Hay un límite de 10 ingresos por minuto desde una misma red, y todas
  las personas de esa red cuentan juntas. Espera un minuto.
- **«La cuenta está bloqueada por varios intentos fallidos…»** Por defecto, cinco intentos fallidos seguidos bloquean la
  cuenta 15 minutos; el administrador de la academia puede cambiar esos valores en **Configuración**. Espera, o pide en
  recepción que restablezcan la contraseña: eso la desbloquea. Si el bloqueado es el único administrador, lo restablece el
  superadmin, en **Administradores** de la academia.
- **«Tu cuenta está desactivada. Consulta en recepción.»** Un administrador de la academia la reactiva.
- **«Academia no disponible por el momento.»** El superadmin suspendió la academia. Sus datos se conservan; se reactiva
  desde la lista de academias.
- **«No encontramos esa academia. Revisa el enlace.»** Revisa el nombre corto de la dirección, por ejemplo
  `/a/delfines/ingresar`.

### Claude Code muestra un error de un hook al abrir una sesión

Si usas Claude Code en tu PC y aparece un error de un hook de inicio (`SessionStart`) que menciona
`preparar-sesion.mjs`, no tienes que hacer nada. Ese hook solo prepara las sesiones de la nube: en tu PC no cambia nada y
no afecta a `npm run dev` ni a las pruebas.

### La migración `20261120190000_reserva_dentro_del_mes` falla con 23514

Síntoma: `npm run db:preparar` se detiene con el mensaje «Falló el paso: Migrando la base de desarrollo», y el error de
PostgreSQL incluye el código `23514` y el nombre `matriculas_reserva_dentro_del_mes`. Volver a ejecutar `npm run db:preparar`
no lo arregla: falla igual.

Causa: la historia 005a agrega la regla de que una reserva sin pago no puede vencer después del fin de su mes. Una base de
desarrollo sembrada con una versión anterior de esta rama tiene reservas de ejemplo que vencen a 365 días, y la migración no
puede aceptarlas. `npm run db:preparar` migra la base que ya existe, sin borrarla, así que repetirlo no basta.

Solución: borra la base de desarrollo y créala de cero. Los pasos son los de [Borrar la base de desarrollo y empezar de
cero](#borrar-la-base-de-desarrollo-y-empezar-de-cero), en PowerShell, dentro de la carpeta del proyecto:

```powershell
docker compose down -v
docker compose up -d
npm run db:preparar
```

**Se pierden los datos de desarrollo**: las academias, los usuarios y las solicitudes que hayas creado en tu PC. El código del
proyecto no cambia. La base de pruebas no tiene reservas de ejemplo, porque la semilla solo va a la de desarrollo; si el paso
«Migrando la base de pruebas» también falla, aplica la misma solución.

### `npm ci` falla con sharp, o la API no arranca con «Could not load the "sharp" module»

Síntoma: `npm run dev` se detiene al encender la API y muestra «Could not load the "sharp" module using the win32-x64 runtime».
(`npm ci` casi nunca falla por sharp: sharp no compila nada al instalarse, así que el problema aparece al arrancar la API).

Causa: los binarios de sharp vienen en dependencias opcionales de npm. En Windows, el binario nativo es `@img/sharp-win32-x64`, que
está en `package-lock.json`. Si `npm ci` no instala las dependencias opcionales (por ejemplo, con `--omit=optional`), sharp no
encuentra ningún binario que cargar, y como la foto lo usa desde el arranque, la API no arranca. El propio mensaje de sharp (en
`node_modules\sharp\dist\sharp.cjs`) pide, como primera comprobación, que las dependencias opcionales se puedan instalar.

Solución:

1. Vuelve a ejecutar `npm ci` en la carpeta del proyecto, sin ninguna opción que omita las dependencias opcionales
   (`--omit=optional` o `--no-optional`), y revisa que termine sin errores.
2. Revisa que `node -v` muestre una versión 22 (ver "Node.js equivocado"). Con `engine-strict=true` en `.npmrc`, `npm ci` se
   detiene si la versión de Node no es la del proyecto.
3. No uses `npm install sharp`. En este proyecto todo se instala desde `package-lock.json` con `npm ci`, y ese otro comando puede
   cambiar el archivo.
4. Si sigue fallando, copia el mensaje completo (sin datos personales) y pídele ayuda a quien mantiene el proyecto. La guía de
   instalación de sharp, a la que remite su propio paquete, está en https://sharp.pixelplumbing.com/install.

### La API no arranca por `ALMACEN_DIRECTORIO`

Síntoma: al encender la API aparece «La variable ALMACEN_DIRECTORIO no es una ruta válida.» o «La variable ALMACEN_DIRECTORIO no
puede estar dentro de las carpetas que sirve la web.»

Causa: el valor de `ALMACEN_DIRECTORIO` en tu `.env` tiene una de las formas de la lista de "Dónde se guardan las fotos", o cae
dentro de `frontend`, `packages` o `node_modules` del proyecto.

Solución: abre `.env` con `notepad .env`, corrige la línea `ALMACEN_DIRECTORIO` o bórrala, guarda el archivo como UTF-8 y vuelve a
ejecutar `npm run dev`. Si la borras, la carpeta vuelve a ser `backend\almacenamiento`. El mensaje no muestra la ruta, así que
compara con la línea de tu `.env`.

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

Es también la solución del error 23514 de la historia 005a (ver «La migración `20261120190000_reserva_dentro_del_mes` falla
con 23514», en «Problemas frecuentes»).
